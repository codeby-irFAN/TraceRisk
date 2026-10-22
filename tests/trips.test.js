import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTripStore } from '../server/trip-store.js';
import { createTripService, validateTrip } from '../server/trip-service.js';
import {
  compareSnapshots,
  evidenceDetails,
  explicitCoordinates,
  answerTripQuestion,
  resolutionReports,
} from '../server/trip-intelligence.js';
import { routeSample, getTripRoutes } from '../server/trip-routing.js';
import { parseDisasterFeed } from '../server/environment.js';
import { createApp } from '../server/app.js';
const location = {
  name: 'Delhi',
  admin1: 'Delhi',
  country: 'India',
  latitude: 28.6,
  longitude: 77.2,
};
const config = {
  title: 'Client journey',
  client: 'Private client',
  origin: null,
  stops: [
    {
      id: 'delhi',
      query: 'Delhi',
      location,
      startDate: '2026-10-22',
      endDate: '2026-10-23',
    },
  ],
  preferences: { mode: 'bus', children: true },
  watch: { enabled: true, frequencyHours: 6, alertLevel: 'all' },
};
const source = {
  id: 'S1',
  title: 'Road bulletin',
  url: 'https://example.com/bulletin',
  fetched: true,
};
const issue = {
  id: 'I1',
  title: 'Mountain pass closure',
  dimension: 'Infrastructure / Transit',
  area: 'Delhi pass',
  evidence:
    'Delhi mountain pass blocked following landslide near northern tunnel.',
  sourceIds: ['S1'],
  score: 65,
};
const result = () => ({
  issues: [structuredClone(issue)],
  sources: [source],
  nextSteps: [],
  weather: {
    forecastDaysMatched: 2,
    tripDays: 2,
    forecastCoverage: 'complete',
  },
  resultStatus: 'available',
  resolutions: [],
});
const snapshot = (issues = [issue]) => ({
  coverage: 'partial',
  reports: [{ key: 'delhi', label: 'Delhi', result: { ...result(), issues } }],
});
test('workspace ownership, persistent storage, claims, share replacement and expiry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracerisk-'));
  let time = Date.parse('2026-10-22T12:00Z');
  const filename = join(dir, 'trips.sqlite');
  let store = createTripStore({ filename, now: () => time });
  try {
    const a = store.createWorkspace(),
      b = store.createWorkspace();
    const trip = store.create(a.workspace.id, config);
    assert.equal(store.get(b.workspace.id, trip.id), null);
    assert.equal(store.authenticate(a.key).id, a.workspace.id);
    assert.equal(store.claim(a.workspace.id, trip.id), true);
    assert.equal(store.claim(a.workspace.id, trip.id), false);
    store.release(a.workspace.id, trip.id);
    const share = store.share(a.workspace.id, trip.id, { title: 'Frozen' });
    assert.equal(store.readShare(share.key).title, 'Frozen');
    const replacement = store.share(a.workspace.id, trip.id, { title: 'New' });
    assert.equal(store.readShare(share.key), null);
    store.close();
    store = createTripStore({ filename, now: () => time });
    assert.equal(store.get(a.workspace.id, trip.id).title, config.title);
    time += 8 * 86400000;
    assert.equal(store.readShare(replacement.key), null);
    assert.throws(
      () => store.update(a.workspace.id, trip.id, 999, {}),
      /changed/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('watch timeline never interprets a disappeared report as resolved', () => {
  const before = snapshot(),
    after = snapshot([]);
  assert.equal(compareSnapshots(before, after)[0].kind, 'not-observed');
  after.reports[0].result.resolutions = [
    {
      evidence:
        'Delhi mountain pass road reopened following landslide near northern tunnel.',
      sourceLinks: [source],
    },
  ];
  assert.equal(compareSnapshots(before, after)[0].kind, 'resolved');
  after.reports[0].result.resolutions = [
    {
      evidence: 'Mumbai coastal railway services resumed after maintenance.',
      sourceLinks: [source],
    },
  ];
  assert.equal(compareSnapshots(before, after)[0].kind, 'not-observed');
  assert.equal(
    resolutionReports([
      {
        ...source,
        publishedAt: '2099-01-01',
        quality: { relevant: true },
        text: 'Delhi mountain pass road reopened following landslide near northern tunnel.',
      },
    ]).length,
    0,
  );
});
test('trip checks, scheduled changes, date comparisons and grounded assistant', async () => {
  let time = Date.parse('2026-10-22T12:00Z'),
    calls = [];
  const store = createTripStore({ now: () => time });
  const w = store.createWorkspace().workspace;
  const trip = store.create(w.id, config);
  const service = createTripService({
    store,
    now: () => time,
    scan: async (args) => {
      calls.push(args);
      return result();
    },
    routes: async () => ({ status: 'not-requested', routes: [], notes: [] }),
    checkpoints: async () => [],
  });
  try {
    await service.tick();
    await service.idle();
    let saved = store.get(w.id, trip.id);
    assert.equal(saved.latest.issueCount, 1);
    assert.equal(saved.timeline[0].kind, 'new');
    assert.ok(
      saved.latest.reports[0].result.issues[0].personalImpact[0].includes(
        'road',
      ),
    );
    service.compare(w.id, trip.id, { dayOffset: 2 });
    await service.idle();
    saved = store.get(w.id, trip.id);
    assert.equal(saved.stops[0].startDate, '2026-10-22');
    assert.equal(saved.comparison.candidate.reports[0].startDate, '2026-10-24');
    assert.equal(calls.length, 2);
    const answer = answerTripQuestion(
      saved,
      'Which issues affect the bus journey?',
    );
    assert.equal(answer.citations[0].url, source.url);
    assert.match(answer.answer, /Delhi/);
    assert.equal(
      answerTripQuestion(saved, 'Who won the cricket match?').citations.length,
      0,
    );
    time += 7 * 3600000;
    await service.tick();
    await service.idle();
    assert.equal(calls.length, 3);
    assert.equal(store.get(w.id, trip.id).timeline.length, 1);
  } finally {
    await service.stop();
    store.close();
  }
});
test('evidence requires actual coordinates, source support and applicable disaster dates', async () => {
  assert.equal(explicitCoordinates('Delhi city centre'), null);
  assert.equal(
    explicitCoordinates('latitude 28.6000 longitude 77.2000').latitude,
    28.6,
  );
  const enriched = evidenceDetails([issue], [source]);
  assert.equal(enriched[0].verification.coordinates, null);
  assert.equal(enriched[0].verification.label, 'Single-source report');
  assert.ok(
    Math.abs(
      routeSample(
        [
          [77, 28],
          [79, 28],
        ],
        0.5,
      ).longitude - 78,
    ) < 0.01,
  );
  assert.equal(
    (await getTripRoutes({ ...config, preferences: { mode: 'train' } })).status,
    'not-requested',
  );
  const xml =
    '<rss><channel><item><title>Flood</title><link>https://www.gdacs.org/report</link><gdacs:alertlevel>Red</gdacs:alertlevel><geo:Point><geo:lat>28.7</geo:lat><geo:long>77.3</geo:long></geo:Point><gdacs:fromdate>2026-10-21</gdacs:fromdate><gdacs:todate>2026-10-23</gdacs:todate></item></channel></rss>';
  assert.equal(
    parseDisasterFeed(xml, location, '2026-10-22', '2026-10-22').length,
    1,
  );
  assert.equal(
    parseDisasterFeed(xml, location, '2026-11-01', '2026-11-02').length,
    0,
  );
  assert.throws(
    () => validateTrip({ ...config, stops: [] }, { get: () => location }),
    /one to six/,
  );
});
test('trip API scopes private data and shares omit client names unless requested', async (t) => {
  const store = createTripStore();
  const app = createApp({
    tripStore: store,
    scan: async () => result(),
    tripServiceOptions: { routes: async () => ({ routes: [], notes: [] }) },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => {
    await app.locals.tripService.stop();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const a = store.createWorkspace(),
    b = store.createWorkspace();
  const trip = store.create(a.workspace.id, config);
  const request = (
    path,
    key,
    body,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.equal((await request('/trips', null)).status, 401);
  assert.equal((await request(`/trips/${trip.id}`, b.key)).status, 404);
  assert.equal(
    (await request(`/trips/${trip.id}/check`, a.key, {})).status,
    202,
  );
  await app.locals.tripService.idle();
  const shared = await (
    await request(`/trips/${trip.id}/share`, a.key, {})
  ).json();
  const publicData = await (
    await request('/shared/' + shared.path.split('/').at(-1))
  ).json();
  assert.equal(publicData.client, '');
  assert.equal(publicData.latest.issueCount, 1);
  assert.equal(
    (await request(`/trips/${trip.id}/share`, a.key, undefined, 'DELETE'))
      .status,
    204,
  );
  assert.equal(
    (await request('/shared/' + shared.path.split('/').at(-1))).status,
    404,
  );
});

test('routing validates provider geometry, retains legs and honestly handles failure', async (t) => {
  const native = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = native;
  });
  const routedTrip = {
    ...config,
    origin: location,
    stops: [
      {
        ...config.stops[0],
        location: { ...location, name: 'Agra', latitude: 27.2, longitude: 78 },
      },
    ],
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 'Ok',
        routes: [
          {
            distance: 220000,
            duration: 18000,
            geometry: {
              coordinates: [
                [77.2, 28.6],
                [77.6, 27.9],
                [78, 27.2],
              ],
            },
            legs: [
              {
                distance: 220000,
                steps: [{ name: 'Expressway', ref: 'NE-4' }],
              },
            ],
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  const routes = await getTripRoutes(routedTrip);
  assert.equal(routes.status, 'available');
  assert.equal(routes.routes[0].durationMinutes, 300);
  assert.equal(routes.routes[0].legDistancesKm[0], 220);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 'Ok',
        routes: [
          {
            distance: 1,
            duration: 1,
            geometry: {
              coordinates: [
                [500, 90],
                [0, 0],
              ],
            },
          },
        ],
      }),
    );
  const bad = await getTripRoutes({
    ...routedTrip,
    origin: { ...location, longitude: 77.3 },
  });
  assert.equal(bad.status, 'unavailable');
  assert.deepEqual(bad.routes, []);
});

test('cancelled trip checks preserve their last completed briefing', async () => {
  const store = createTripStore();
  const workspace = store.createWorkspace().workspace;
  const trip = store.create(workspace.id, config);
  const previous = store.update(workspace.id, trip.id, trip.revision, {
    latest: snapshot(),
  });
  const service = createTripService({
    store,
    scan: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return result();
    },
    routes: async () => ({ routes: [], notes: [] }),
  });
  try {
    service.check(workspace.id, trip.id);
    service.cancel(workspace.id, trip.id);
    await service.idle();
    assert.deepEqual(store.get(workspace.id, trip.id).latest, previous.latest);
    assert.match(store.get(workspace.id, trip.id).lastError, /cancelled/);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(store.get(workspace.id, trip.id).latest, previous.latest);
  } finally {
    await service.stop();
    store.close();
  }
});

test('resolution extraction rejects negation and speculative reopening', () => {
  const sources = [
    'No roads reopened after the Delhi mountain pass landslide.',
    'Delhi mountain pass roads reopened following clearance of the landslide.',
    'Reports that Delhi mountain pass roads reopened are false.',
    'Delhi mountain pass roads reopened if the weather improves, officials said.',
  ].map((text, i) => ({
    ...source,
    id: `R${i}`,
    text,
    publishedAt: '2026-10-22',
    quality: { relevant: true },
  }));
  const matches = resolutionReports(sources, Date.parse('2026-10-22T12:00Z'));
  assert.equal(matches.length, 1);
  assert.match(matches[0].evidence, /following clearance/);
});

test('an explicit resolution can arrive after several missing-report checks', async () => {
  const { snapshotChanges } = await import('../server/trip-intelligence.js');
  const initial = snapshot(),
    missing = snapshot([]);
  let diff = snapshotChanges(initial, missing);
  missing.pendingSignals = diff.pending;
  assert.equal(diff.events[0].kind, 'not-observed');
  const stillMissing = snapshot([]);
  diff = snapshotChanges(missing, stillMissing);
  stillMissing.pendingSignals = diff.pending;
  assert.equal(diff.events.length, 0);
  const reopened = snapshot([]);
  reopened.reports[0].result.resolutions = [
    {
      evidence:
        'Delhi mountain pass road reopened following landslide near northern tunnel.',
      sourceLinks: [source],
    },
  ];
  diff = snapshotChanges(stillMissing, reopened);
  assert.equal(diff.events[0].kind, 'resolved');
  assert.equal(diff.pending.length, 0);
});
