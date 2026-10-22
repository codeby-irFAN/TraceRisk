import { createHash } from 'node:crypto';
import { normalText, publisherKey, publicationDay } from './evidence.js';
import { cleanText } from './utils.js';

const DAY = 86400000;
const hash = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);
const words = (text) =>
  new Set(
    normalText(text)
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            'with',
            'from',
            'that',
            'this',
            'have',
            'been',
            'will',
            'traffic',
            'police',
            'report',
            'roads',
            'road',
            'advisory',
          ].includes(w),
      ),
  );
function overlap(a, b) {
  const left = words(a),
    right = words(b);
  return (
    [...left].filter((word) => right.has(word)).length /
    Math.max(1, Math.min(left.size, right.size))
  );
}
export function explicitCoordinates(text) {
  const match = String(text).match(
    /\blatitude\s*[:=]?\s*(-?\d{1,2}\.\d{3,})\s*[,;\s]+longitude\s*[:=]?\s*(-?\d{1,3}\.\d{3,})/i,
  );
  if (!match) return null;
  const latitude = Number(match[1]),
    longitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? {
        latitude,
        longitude,
        basis: 'Coordinates explicitly present in the cited passage',
      }
    : null;
}
export function evidenceDetails(
  issues,
  sources,
  checkedAt = new Date().toISOString(),
) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  return issues.map((issue) => {
    const linked = (issue.sourceIds || [])
      .map((id) => sourceMap.get(id))
      .filter(Boolean);
    const matching = issues.filter(
      (other) =>
        other.id !== issue.id &&
        other.dimension === issue.dimension &&
        other.area === issue.area &&
        overlap(issue.evidence, other.evidence) >= 0.65,
    );
    const supporting = [
      ...new Map(
        [
          ...linked,
          ...matching.flatMap((i) =>
            i.sourceIds.map((id) => sourceMap.get(id)).filter(Boolean),
          ),
        ].map((s) => [s.id, s]),
      ).values(),
    ];
    const opposing = sources.filter(
      (s) =>
        s.fetched &&
        s.quality?.relevant &&
        s.quality?.recency === 'recent' &&
        /\b(reopened|restrictions? lifted|services? resumed|warning withdrawn)\b/i.test(
          s.text || s.preview || '',
        ) &&
        overlap(issue.evidence, s.text || s.preview) >= 0.6,
    );
    const publishers = new Set(supporting.map((s) => publisherKey(s.url))).size;
    const forecast = linked.some(
      (s) => s.group === 'weather-api' || s.group === 'air-quality-api',
    );
    const dates = [
      ...new Set(
        String(issue.evidence || '').match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [],
      ),
    ];
    const label = opposing.length
      ? 'Conflicting reports'
      : forecast
        ? 'Model forecast'
        : publishers >= 2
          ? 'Multiple publishers report this'
          : 'Single-source report';
    return {
      ...issue,
      verification: {
        label,
        confidence: opposing.length
          ? 'Uncertain'
          : forecast
            ? 'Model-based'
            : publishers >= 2
              ? 'Corroborating reports'
              : 'Limited corroboration',
        explanation:
          'Evidence strength describes source support, not a probability that travel is safe. Similar reports can share an original source.',
        affectedArea: issue.area,
        eventDates: dates,
        dateBasis: issue.dateBasis || 'Unknown',
        eventDateNote: dates.length
          ? dates.join(', ')
          : issue.dateBasis === 'event-dates-with-publication-year'
            ? 'Month/day appears in the quotation; year inferred from publication.'
            : 'Exact event dates are not established; see the quotation and publication date.',
        checkedAt,
        supporting: supporting.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          publishedAt: s.publishedAt,
          retrievedAt: s.retrievedAt || checkedAt,
          fetched: s.fetched,
        })),
        conflicts: opposing.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          quote: cleanText(s.text || s.preview, 450),
        })),
        coordinates: issue.coordinates || explicitCoordinates(issue.evidence),
      },
    };
  });
}
export function impactFor(issue, preferences = {}) {
  const impacts = [];
  const mode = preferences.mode || 'car';
  if (issue.dimension === 'Infrastructure / Transit') {
    if (['car', 'bus', 'motorcycle'].includes(mode))
      impacts.push(
        'Confirm the affected road stretch and allow a diversion buffer; published journey times exclude live closures.',
      );
    if (mode === 'train')
      impacts.push(
        'Check the train number and station access with Indian Railways; a nearby road report does not establish a train cancellation.',
      );
    if (mode === 'flight')
      impacts.push(
        'Check flight status and airport access separately; local road conditions may affect the transfer.',
      );
  }
  if (issue.dimension === 'Environmental') {
    impacts.push(
      mode === 'motorcycle'
        ? 'Rain, wind and reduced visibility can have a greater impact on a motorcycle journey. Consider a different departure time.'
        : 'Check the forecast near departure and keep a fallback for outdoor activities or transfers.',
    );
    if (preferences.children)
      impacts.push(
        'Plan indoor breaks, drinking water and additional time for children.',
      );
    if (preferences.respiratory)
      impacts.push(
        'Review local air-quality guidance and your usual clinician-advised precautions; forecasts are not medical advice.',
      );
  }
  if (preferences.limitedMobility)
    impacts.push(
      'Verify step-free transfers, accessible accommodation and whether any diversion changes access.',
    );
  if (preferences.children && issue.dimension === 'Geopolitical & Civil')
    impacts.push(
      'Avoid reported gathering areas and confirm a direct arrival route with your accommodation.',
    );
  return impacts.length
    ? impacts
    : [
        issue.travelerImpact ||
          'Confirm the current local situation and whether it affects your plans.',
      ];
}
export function coverageChecks(result) {
  const lanes = result.searchLaneStats || [];
  const groups = [
    [
      'weather',
      'Weather for your dates',
      result.weather?.forecastCoverage === 'complete'
        ? 'checked'
        : result.weather?.forecastDaysMatched
          ? 'partial'
          : 'unknown',
      `${result.weather?.forecastDaysMatched || 0} of ${result.weather?.tripDays || 0} travel days available`,
    ],
    [
      'transport',
      'Transport and road reports',
      ...laneState(
        lanes.filter((s) =>
          ['traffic', 'transport', 'infrastructure'].includes(s.id),
        ),
      ),
    ],
    [
      'advisories',
      'Restrictions and local reports',
      ...laneState(
        lanes.filter((s) =>
          ['official-advisories', 'civil-unrest', 'regional-news'].includes(
            s.id,
          ),
        ),
      ),
    ],
    [
      'air',
      'Air-quality forecast',
      result.environment?.airQuality?.status === 'available'
        ? 'checked'
        : 'unknown',
      result.environment?.airQuality?.status === 'available'
        ? 'Air-quality forecast available for your trip.'
        : 'Check air quality closer to departure.',
    ],
  ];
  return groups.map(([id, label, status, detail]) => ({
    id,
    label,
    status,
    detail,
  }));
}
function laneState(lanes) {
  const done = lanes.filter((s) => s.succeeded).length;
  return [
    done === lanes.length && done ? 'searched' : done ? 'partial' : 'unknown',
    done
      ? 'Recent local reports checked.'
      : 'Live updates are unavailable. Check with your operator.',
  ];
}
export function decisionFor(result) {
  const issues = result.issues || [],
    checks = coverageChecks(result);
  const conflicts = issues.some((i) => i.verification?.conflicts?.length);
  const score = Math.max(0, ...issues.map((i) => i.score || 0));
  const unknown = checks
    .filter((c) => c.status === 'unknown')
    .map((c) => c.label);
  return {
    code: conflicts
      ? 'verify'
      : score >= 60
        ? 'review'
        : issues.length
          ? 'precautions'
          : 'routine',
    title: conflicts
      ? 'Verify conflicting reports before departure'
      : score >= 60
        ? 'Review this part of your plan'
        : issues.length
          ? 'Plan around the reported conditions'
          : result.sources?.length
            ? 'No major disruptions found in the updates checked'
            : 'Check local conditions before leaving',
    detail: issues.length
      ? `${issues.length} report or forecast signal${issues.length === 1 ? '' : 's'} to review. Confirm current applicability with the cited authority or operator.`
      : result.sources?.length
        ? 'Review the forecast and departure checklist below.'
        : 'Live updates could not be collected. Your itinerary and departure checklist are still available.',
    checks,
    gaps: unknown,
    safetyProbability: null,
  };
}
function identity(issue, stop) {
  // Source IDs are local to a scan. URLs and an evidence excerpt identify changes.
  const normalized = normalText(issue.evidence || issue.title)
    .replace(/20\d{2}-\d{2}-\d{2}/g, '')
    .replace(/\b\d+(?:\.\d+)?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return hash(
    `${stop}|${issue.dimension}|${issue.area}|${normalized.slice(0, 350)}`,
  );
}
export function snapshotChanges(
  before,
  after,
  time = new Date().toISOString(),
) {
  const flatten = (snapshot) =>
    (snapshot?.reports || []).flatMap((report) =>
      (report.result?.issues || []).map((issue) => ({
        ...issue,
        stop: report.label,
        result: report.result,
        key: identity(issue, report.key),
      })),
    );
  const previous = new Map(
    [...(before?.pendingSignals || []), ...flatten(before)].map((i) => [
      i.key,
      i,
    ]),
  );
  const current = new Map(flatten(after).map((i) => [i.key, i]));
  const changes = [],
    pending = [];
  for (const [key, issue] of current) {
    const old = previous.get(key);
    if (
      !old ||
      old.notObserved ||
      old.score !== issue.score ||
      old.verification?.label !== issue.verification?.label
    )
      changes.push({
        id: hash(`${time}|${key}|observed`),
        kind: old ? 'changed' : 'new',
        title: issue.title,
        stop: issue.stop,
        at: time,
        detail: old
          ? old.notObserved
            ? 'This signal was observed again after a gap in reporting.'
            : 'The reported severity or source support changed.'
          : 'A report or forecast signal appeared in this check.',
        sourceIds: issue.sourceIds,
        sourceLinks: issue.result.sources
          .filter((s) => issue.sourceIds.includes(s.id))
          .map((s) => ({ title: s.title, url: s.url })),
        read: false,
      });
  }
  for (const [key, issue] of previous)
    if (!current.has(key)) {
      const report = after.reports.find((r) => r.label === issue.stop);
      // A disappearance or provider failure is never proof that an incident cleared.
      const resolved = (report?.result?.resolutions || []).find(
        (r) => overlap(issue.evidence, r.evidence) >= 0.65,
      );
      if (!resolved)
        pending.push({ ...issue, result: undefined, notObserved: true });
      if (issue.notObserved && !resolved) continue;
      changes.push({
        id: hash(`${time}|${key}|missing`),
        kind: resolved ? 'resolved' : 'not-observed',
        title: issue.title,
        stop: issue.stop,
        at: time,
        detail: resolved
          ? 'A current source explicitly reports reopening or withdrawal. Check the original notice.'
          : 'Not observed in this check. It may still apply; this is not confirmation that it cleared.',
        sourceLinks: resolved?.sourceLinks || [],
        read: false,
      });
    }
  if (before && before.coverage !== after.coverage)
    changes.push({
      id: hash(`${time}|coverage`),
      kind: 'coverage',
      title: 'Availability of travel updates changed',
      at: time,
      detail:
        after.coverage === 'unavailable'
          ? 'Live updates could not be collected in this check. Try again before leaving.'
          : 'New information is available. Review the latest trip check.',
      sourceLinks: [],
      read: false,
    });
  return { events: changes, pending: pending.slice(0, 100) };
}
export function compareSnapshots(before, after, time) {
  return snapshotChanges(before, after, time).events;
}
export function assertedResolution(text) {
  return (
    /\b(roads? reopened|restrictions? lifted|services? resumed|warning withdrawn)\b/i.test(
      text,
    ) &&
    !/\b(no|not|never|false|denied|unconfirmed|expected|will|may|could|planned|likely|if|would|previously)\b|last year/i.test(
      text,
    )
  );
}
export function resolutionReports(sources, now = Date.now()) {
  return sources
    .filter(
      (s) =>
        s.fetched &&
        s.quality?.relevant &&
        publicationDay(s.publishedAt) &&
        now - Date.parse(publicationDay(s.publishedAt)) >= 0 &&
        now - Date.parse(publicationDay(s.publishedAt)) < 2 * DAY,
    )
    .flatMap((s) =>
      String(s.text || '')
        .split(/(?<=[.!?])\s+|\n+/)
        .filter(
          (p) => p.length >= 35 && p.length < 700 && assertedResolution(p),
        )
        .slice(0, 2)
        .map((evidence) => ({
          evidence,
          sourceLinks: [{ title: s.title, url: s.url }],
          publishedAt: s.publishedAt,
        })),
    );
}
export function answerTripQuestion(trip, question, now = Date.now()) {
  const q = normalText(question),
    latest = trip.latest;
  if (!latest)
    return {
      answer: 'Check this trip first so I can use its latest travel updates.',
      citations: [],
      missing: [],
    };
  const citations = [],
    missing = [];
  const cite = (source) => {
    if (!source?.url || !/^https?:\/\//.test(source.url)) return '';
    let index = citations.findIndex((s) => s.url === source.url);
    if (index < 0) {
      index = citations.length;
      citations.push({
        title: source.title || 'Original report',
        url: source.url,
        label: `[${index + 1}]`,
      });
    }
    return `[${index + 1}]`;
  };
  const stale = now - Date.parse(latest.checkedAt) > 86400000;
  if (stale)
    missing.push(
      'This briefing is more than a day old. Check the trip again for current updates.',
    );
  if (/what.*chang|why.*chang|timeline|since|resolved|cleared/.test(q)) {
    const events = (trip.timeline || []).slice(0, 5);
    return {
      answer: events.length
        ? events
            .map(
              (e) =>
                `${e.at.slice(0, 10)}: ${e.title}. ${e.detail} ${(e.sourceLinks || []).map(cite).join(' ')}`,
            )
            .join('\n\n')
        : 'No changes recorded yet. Check the trip again to compare it with the previous update.',
      citations,
      missing,
    };
  }
  if (
    /itinerary|my stops|which places|where.*visit|when.*arriv|when.*depart|trip dates/.test(
      q,
    )
  )
    return {
      answer: trip.stops
        .map(
          (s, i) =>
            `${i + 1}. ${s.location.name}${s.location.city ? `, ${s.location.city}` : ''}: ${s.startDate} to ${s.endDate}`,
        )
        .join('\n'),
      citations: [],
      missing,
    };
  if (/compar|alternative|better route|best route|different date/.test(q)) {
    if (!trip.comparison)
      return {
        answer:
          'Open Compare to check another departure date or an available road route. I need that comparison before I can explain the differences.',
        citations: [],
        missing,
      };
    const candidate = trip.comparison.candidate;
    const lines = [
      `Your saved plan has ${latest.issueCount} travel updates to review. The option ${trip.comparison.dayOffset} ${trip.comparison.dayOffset === 1 ? 'day' : 'days'} later has ${candidate.issueCount}.`,
      'Compare the actual updates and weather in the Compare tab; the number of reports alone does not tell us which option is safer.',
    ];
    for (const r of candidate.reports)
      for (const i of r.result.issues || [])
        lines.push(
          `${r.label}: ${i.summary || i.title} ${r.result.sources
            .filter((s) => i.sourceIds?.includes(s.id))
            .map(cite)
            .join(' ')}`,
        );
    return { answer: lines.slice(0, 6).join('\n\n'), citations, missing };
  }
  const requested =
    q.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ||
    (/tomorrow/.test(q)
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
          new Date(now + DAY),
        )
      : null);
  let reports = latest.reports || [];
  const targeted = reports.filter((r) =>
    [r.location?.name, r.location?.city]
      .filter(Boolean)
      .some((p) => q.includes(normalText(p))),
  );
  if (targeted.length) reports = targeted;
  if (requested) {
    reports = reports.filter(
      (r) => r.startDate <= requested && r.endDate >= requested,
    );
    if (!reports.length)
      return {
        answer: `Your saved checks do not cover ${requested}. Update your itinerary dates and check the trip again.`,
        citations: [],
        missing,
      };
  }
  if (
    /opening|open today|open tomorrow|open time|hours|ticket|entry fee|timings/.test(
      q,
    )
  ) {
    const lines = [];
    for (const r of reports) {
      const name = r.location?.name || r.label;
      const passages = (r.result.sources || [])
        .filter((s) => s.fetched && s.quality?.relevant !== false)
        .flatMap((s) =>
          String(s.text || '')
            .split(/\n+|(?<=[.!?])\s+/)
            .filter(
              (p) =>
                normalText(p).includes(normalText(name)) &&
                /opening hours|opens? at|entry timings|visiting hours|ticket price|entry fee/i.test(
                  p,
                ),
            )
            .slice(0, 1)
            .map((p) => `${p.slice(0, 400)} ${cite(s)}`),
        );
      lines.push(
        passages.length
          ? `${name}: ${passages.join(' ')}`
          : `I do not have verified opening hours or ticket prices for ${name}. Check the attraction’s official website before visiting.`,
      );
    }
    return { answer: lines.join('\n\n'), citations, missing };
  }
  const weather =
      /weather|rain|flood|heat|temperature|forecast|air quality|aqi/.test(q),
    transport = /bus|road|drive|car|train|flight|transport/.test(q);
  if (
    !weather &&
    !transport &&
    !/check|leav|safe|risk|precaution|child|mobilit|trip|report|source|advice|recommend|help|should|visit/.test(
      q,
    )
  )
    return {
      answer:
        'I can help with your itinerary, weather, transport, departure checks and changes. Ask about one of your saved stops.',
      citations: [],
      missing,
    };
  const lines = [];
  if (weather)
    for (const r of reports) {
      const days = (r.result.weather?.dailyForecast || []).filter(
        (d) => !requested || d.date === requested,
      );
      for (const d of days.slice(0, 3)) {
        const refs = (r.result.sources || [])
          .filter((s) => s.group === 'weather-api')
          .map(cite)
          .join(' ');
        lines.push(
          `${r.label}, ${d.date}: ${d.condition || 'Forecast available'}${d.minC != null && d.maxC != null ? `, ${d.minC}–${d.maxC}°C` : ''}${d.precipitationMm != null ? `, ${d.precipitationMm} mm rain` : ''}. ${refs}`,
        );
      }
      if (/air quality|aqi/.test(q)) {
        const air = (r.result.environment?.airQuality?.days || []).filter(
          (d) => !requested || d.date === requested,
        );
        air.forEach((d) =>
          lines.push(
            `${r.label}, ${d.date}: forecast air quality ${d.usAqi <= 50 ? 'good' : d.usAqi <= 100 ? 'moderate' : d.usAqi <= 150 ? 'unhealthy for sensitive travellers' : 'unhealthy'}. ${(
              r.result.sources || []
            )
              .filter((s) => s.group === 'air-quality-api')
              .map(cite)
              .join(' ')}`,
          ),
        );
        if (!air.length)
          missing.push(
            `No air-quality forecast is available for ${r.label} on those dates.`,
          );
      }
      if (!days.length && !/air quality|aqi/.test(q))
        missing.push(
          `No daily weather forecast is available for ${r.label} on those dates yet.`,
        );
    }
  let selected = reports
    .flatMap((r) =>
      (r.result.issues || [])
        .filter((i) => !weather || i.dimension === 'Environmental')
        .map((issue) => ({ report: r, issue })),
    )
    .slice(0, 4);
  if (transport)
    selected = selected.filter(({ issue }) =>
      [
        'Infrastructure / Transit',
        'Environmental',
        'Geopolitical & Civil',
      ].includes(issue.dimension),
    );
  for (const { report, issue } of selected)
    lines.push(
      `${report.label}: ${issue.summary || issue.title} ${(
        report.result.sources || []
      )
        .filter((s) => issue.sourceIds?.includes(s.id))
        .map(cite)
        .join(
          ' ',
        )}\n${impactFor(issue, { ...trip.preferences, mode: /bus/.test(q) ? 'bus' : /train/.test(q) ? 'train' : /flight/.test(q) ? 'flight' : trip.preferences.mode }).join(' ')}`,
    );
  if (transport && /train|flight/.test(q))
    missing.push(
      'I do not have live train or flight status. Check your booking with the operator.',
    );
  if (!lines.length)
    lines.push(
      'No matching disruption was found in the saved updates. Here is what to check before leaving:',
    );
  if (!weather || !lines.length || lines[0].startsWith('No matching'))
    for (const r of reports.slice(0, 2))
      for (const check of (r.result.nextSteps || []).slice(0, 2))
        lines.push(
          `${r.label}: ${check.title}. ${check.detail || ''} ${cite(check)}`,
        );
  if (!reports.some((r) => r.result.sources?.length))
    missing.push(
      'Live reports are unavailable. Confirm local conditions with your operator or accommodation.',
    );
  return {
    answer: lines.join('\n\n'),
    citations,
    missing: [...new Set(missing)],
  };
}
