import { randomUUID } from 'node:crypto';
import { cleanText, isDate } from './utils.js';
import { normalizeDestination, locationLabel } from './locations.js';
import {
  withRequestBudget,
  createConcurrencyGate,
  currentSignal,
} from './http.js';
import { getTripRoutes, getRouteCheckpoints } from './trip-routing.js';
import {
  snapshotChanges,
  decisionFor,
  impactFor,
} from './trip-intelligence.js';
import { tripError } from './trip-store.js';

const day = (date, offset) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
export function validateTrip(body, resolver, existing = null) {
  if (
    !body ||
    !Array.isArray(body.stops) ||
    !body.stops.length ||
    body.stops.length > 6
  )
    throw tripError('Add one to six confirmed stops.');
  const resolvePlace = (value, old) => {
    if (
      old &&
      value?.savedId === old.id &&
      normalizeDestination(value.query) === normalizeDestination(old.query)
    )
      return old.location;
    const location = resolver.get(value?.locationId, value?.query);
    if (!location)
      throw tripError('Find and confirm each place before saving.');
    const { id, ...stored } = location;
    return stored;
  };
  const stops = body.stops.map((s) => {
    if (
      !isDate(s.startDate) ||
      !isDate(s.endDate) ||
      s.startDate > s.endDate ||
      Date.parse(s.endDate) - Date.parse(s.startDate) > 29 * 86400000
    )
      throw tripError('Each stop needs valid dates spanning at most 30 days.');
    const old = existing?.stops.find((x) => x.id === s.savedId);
    return {
      id: old?.id || randomUUID(),
      query: cleanText(s.query, 90),
      location: resolvePlace(s, old),
      startDate: s.startDate,
      endDate: s.endDate,
    };
  });
  if (
    stops.some((s, i) => i > 0 && s.startDate < stops[i - 1].endDate) ||
    Date.parse(stops.at(-1).endDate) - Date.parse(stops[0].startDate) >
      89 * 86400000
  )
    throw tripError('Stops must follow date order within a 90-day itinerary.');
  const oldOrigin = existing?.origin
    ? {
        id: existing.originId,
        query: existing.originQuery,
        location: existing.origin,
      }
    : null;
  const origin = body.origin ? resolvePlace(body.origin, oldOrigin) : null;
  const mode = ['car', 'bus', 'train', 'flight', 'motorcycle'].includes(
    body.preferences?.mode,
  )
    ? body.preferences.mode
    : 'car';
  const frequencyHours = Number(body.watch?.frequencyHours || 6);
  if (![1, 3, 6, 12, 24].includes(frequencyHours))
    throw tripError('Choose a supported watch frequency.');
  return {
    title: cleanText(body.title || `${stops[0].location.name} journey`, 80),
    client: cleanText(body.client, 80),
    notes: cleanText(body.notes, 400),
    origin,
    originId: origin ? existing?.originId || randomUUID() : null,
    originQuery: origin ? cleanText(body.origin.query, 90) : '',
    stops,
    preferences: {
      mode,
      children: body.preferences?.children === true,
      limitedMobility: body.preferences?.limitedMobility === true,
      respiratory: body.preferences?.respiratory === true,
    },
    watch: {
      enabled: body.watch?.enabled === true,
      frequencyHours,
      alertLevel: body.watch?.alertLevel === 'high' ? 'high' : 'all',
    },
  };
}
export function unavailableReport(stop, error) {
  const result = {
    destination: stop.label,
    startDate: stop.startDate,
    endDate: stop.endDate,
    checkedAt: new Date().toISOString(),
    issues: [],
    sources: [],
    leads: [],
    resultStatus: 'unavailable',
    coverageStatus: 'inconclusive',
    searchLaneStats: [],
    briefing:
      'Live information could not be collected for this stop. Your itinerary and departure checks remain available.',
    nextSteps: [
      {
        title: 'Check official weather warnings',
        detail: 'Check IMD warnings for this place and date.',
        url: 'https://mausam.imd.gov.in/',
      },
      {
        title: 'Confirm your journey with the operator',
        detail:
          'Check road access, train or flight status and your arrival arrangements.',
        url: 'https://enquiry.indianrail.gov.in/mntes/',
      },
    ],
    sourceHealth: { error: cleanText(error?.message || error, 180) },
    weather: {
      forecastStatus: 'unavailable',
      forecastDaysMatched: 0,
      tripDays:
        Math.round(
          (Date.parse(stop.endDate) - Date.parse(stop.startDate)) / 86400000,
        ) + 1,
      dailyForecast: [],
      forecastCoverage: 'unavailable',
    },
  };
  result.decision = decisionFor(result);
  return result;
}
function snapshotSummary(reports) {
  const issues = reports.flatMap((r) => r.result.issues || []);
  const covered = reports.filter((r) => r.result.sources?.length).length;
  return {
    issueCount: issues.length,
    highSignals: issues.filter((i) => i.score >= 60).length,
    reportsChecked: covered,
    reportsTotal: reports.length,
    forecastDays: reports.reduce(
      (n, r) => n + (r.result.weather?.forecastDaysMatched || 0),
      0,
    ),
    coverage:
      covered === reports.length
        ? 'collected with stated gaps'
        : covered
          ? 'partial'
          : 'unavailable',
    highestSignal: Math.max(0, ...issues.map((i) => i.score || 0)),
  };
}
export function createTripService({
  store,
  scan,
  routes = getTripRoutes,
  checkpoints = getRouteCheckpoints,
  now = Date.now,
}) {
  const jobs = new Map(),
    gate = createConcurrencyGate(3),
    scanCache = new Map();
  let interval = null,
    ticking = false;
  async function inspect(target, preferences) {
    const key = JSON.stringify([
      target.location.latitude,
      target.location.longitude,
      target.startDate,
      target.endDate,
    ]);
    const hit = scanCache.get(key);
    let result;
    if (hit && now() - hit.time < 300000) result = structuredClone(hit.result);
    else {
      const promise = gate(() =>
        scan({
          destination: locationLabel(target.location),
          location: target.location,
          startDate: target.startDate,
          endDate: target.endDate,
        }),
      ).then((r) => ({
        ...r,
        checkedAt: r.checkedAt || new Date(now()).toISOString(),
      }));

      while (scanCache.size > 100)
        scanCache.delete(scanCache.keys().next().value);
      try {
        result = structuredClone(await promise);
        currentSignal()?.throwIfAborted();
        if (result.resultStatus !== 'unavailable')
          scanCache.set(key, { result: structuredClone(result), time: now() });
      } catch (error) {
        scanCache.delete(key);
        throw error;
      }
    }
    result.issues = (result.issues || []).map((issue) => ({
      ...issue,
      personalImpact: impactFor(issue, preferences),
    }));
    result.decision ||= decisionFor(result);
    return result;
  }
  async function collect(trip, routeIndex = 0) {
    const targetStops = trip.stops.map((s) => ({
      ...s,
      key: s.id,
      label: locationLabel(s.location),
      kind: 'stop',
    }));
    if (trip.origin)
      targetStops.unshift({
        key: 'origin',
        label: locationLabel(trip.origin),
        location: trip.origin,
        startDate: trip.stops[0].startDate,
        endDate: trip.stops[0].startDate,
        kind: 'origin',
      });
    // Start stop analysis while route geometry and corridor place lookups run.
    const stopWork = targetStops.map(async (target) => ({
      ...target,
      result: await inspect(target, trip.preferences).catch((error) =>
        unavailableReport(target, error),
      ),
    }));
    let routing;
    try {
      routing = await routes(trip);
    } catch (error) {
      routing = {
        status: 'unavailable',
        routes: [],
        notes: [cleanText(error.message, 180)],
      };
    }
    const selected = routing.routes?.[routeIndex];
    const corridor = selected
      ? await checkpoints(selected, trip).catch(() => [])
      : [];
    const routeData = {
      ...routing,
      selectedRouteId: selected?.id || null,
      checkpoints: corridor,
      corridorChecked: corridor.length > 0,
      notes: [
        ...(routing.notes || []),
        ...(selected && !corridor.length && selected.distanceKm >= 100
          ? [
              'Intermediate locations could not be resolved; coverage is limited to the confirmed stops.',
            ]
          : []),
      ],
    };
    const extra = corridor.slice(0, 2).map((location, i) => ({
      key: `checkpoint-${i}-${location.name}`,
      label: `Near ${location.name}, ${location.admin1}`,
      location,
      startDate: location.startDate || trip.stops[0].startDate,
      endDate: location.endDate || trip.stops[0].startDate,
      kind: 'checkpoint',
    }));
    // Checkpoint dates follow the departure and arrival window of their route leg.
    if (trip.stops.length > 1 && extra.length)
      routeData.notes.push(
        'Intermediate road checkpoints use their leg’s departure-to-arrival dates. Up to two sampled areas are checked; this is not continuous coverage of every road segment.',
      );
    const reports = await Promise.all([
      ...stopWork,
      ...extra.map(async (target) => ({
        ...target,
        result: await inspect(target, trip.preferences).catch((error) =>
          unavailableReport(target, error),
        ),
      })),
    ]);
    return {
      checkedAt: new Date(now()).toISOString(),
      reports,
      route: routeData,
      ...snapshotSummary(reports),
    };
  }
  function launch(workspace, trip, kind, task) {
    if (jobs.size >= 2)
      throw tripError(
        'Two trip checks are already running. Try again shortly.',
        429,
      );
    if (!store.claim(workspace, trip.id))
      throw tripError('This trip is already being checked.', 409);
    const controller = new AbortController();
    const key = `${workspace}:${trip.id}`;
    const promise = withRequestBudget(
      task,
      110000,
      'Trip check reached its time limit. Your last briefing is preserved.',
      controller.signal,
    )
      .catch((error) => {
        const current = store.get(workspace, trip.id);
        if (current && current.revision === trip.revision)
          store.update(workspace, trip.id, current.revision, {
            lastError: controller.signal.aborted
              ? 'Check cancelled. Your previous briefing is preserved.'
              : cleanText(error.message, 180),
            nextCheckAt: new Date(now() + 3600000).toISOString(),
          });
      })
      .finally(() => {
        jobs.delete(key);
        store.release(workspace, trip.id);
      });
    jobs.set(key, { promise, controller, kind });
    return { status: 'checking', kind };
  }
  const service = {
    status: () => ({ activeChecks: jobs.size, monitoring: Boolean(interval) }),
    check(workspace, id) {
      const trip = store.get(workspace, id);
      if (!trip) throw tripError('Trip not found.', 404);
      return launch(workspace, trip, 'check', async () => {
        const latest = await collect(trip);
        currentSignal()?.throwIfAborted();
        const current = store.get(workspace, id);
        if (!current || current.revision !== trip.revision) return;
        const diff = snapshotChanges(trip.latest, latest, latest.checkedAt);
        latest.pendingSignals = diff.pending;
        let changes = diff.events;
        if (trip.watch.alertLevel === 'high')
          changes = changes.filter(
            (e) =>
              e.kind !== 'new' ||
              latest.reports.some((r) =>
                r.result.issues?.some(
                  (i) => i.title === e.title && i.score >= 60,
                ),
              ),
          );
        const timeline = [...changes, ...(trip.timeline || [])].slice(0, 100);
        store.update(workspace, id, trip.revision, {
          latest,
          comparison: null,
          timeline,
          lastError: null,
          nextCheckAt: new Date(
            now() + trip.watch.frequencyHours * 3600000,
          ).toISOString(),
        });
      });
    },
    compare(workspace, id, { dayOffset = 1, routeIndex = 0 } = {}) {
      const trip = store.get(workspace, id);
      if (!trip?.latest)
        throw tripError('Complete a trip check before comparing options.', 409);
      if (
        !Number.isInteger(dayOffset) ||
        dayOffset < 0 ||
        dayOffset > 7 ||
        !Number.isInteger(routeIndex) ||
        routeIndex < 0 ||
        routeIndex > 2 ||
        (routeIndex && !trip.latest.route.routes[routeIndex])
      )
        throw tripError(
          'Choose a supported route and departure shift of zero to seven days.',
        );
      if (dayOffset === 0 && routeIndex === 0)
        throw tripError('Choose a different date or route.');
      return launch(workspace, trip, 'comparison', async () => {
        const shifted = {
          ...trip,
          stops: trip.stops.map((s) => ({
            ...s,
            startDate: day(s.startDate, dayOffset),
            endDate: day(s.endDate, dayOffset),
          })),
        };
        const candidate = await collect(shifted, routeIndex);
        currentSignal()?.throwIfAborted();
        const current = store.get(workspace, id);
        if (!current || current.revision !== trip.revision) return;
        store.update(workspace, id, trip.revision, {
          comparison: {
            checkedAt: new Date(now()).toISOString(),
            dayOffset,
            routeIndex,
            candidate,
            notes: [
              'Compare report dates, coverage and personal impact as well as journey time. A lower report count does not prove that an option is safer.',
              'Journey times are driving estimates and do not include live disruptions.',
            ],
          },
          lastError: null,
        });
      });
    },
    cancel(workspace, id) {
      const job = jobs.get(`${workspace}:${id}`);
      job?.controller.abort();
      return Boolean(job);
    },
    async idle() {
      await Promise.all([...jobs.values()].map((j) => j.promise));
    },
    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        for (const due of store.due()) {
          if (jobs.size >= 2) break;
          try {
            service.check(due.workspace, due.id);
          } catch {
            /* Already claimed or capacity changed. */
          }
        }
      } finally {
        ticking = false;
      }
    },
    start() {
      if (!interval) {
        interval = setInterval(() => service.tick(), 60000);
        interval.unref();
        service.tick();
      }
    },
    async stop() {
      clearInterval(interval);
      interval = null;
      for (const job of jobs.values()) job.controller.abort();
      await service.idle();
    },
  };
  return service;
}
