import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalyzer } from '../server/analyze.js';
import {
  currentSignal,
  sleep,
  withRequestBudget,
  createConcurrencyGate,
  fetchJson,
} from '../server/http.js';
import { createScanManager } from '../server/scan-manager.js';

const trip = {
  destination: 'Delhi, India',
  location: { name: 'Delhi', admin1: 'Delhi', latitude: 28.6, longitude: 77.2 },
  startDate: '2026-10-22',
  endDate: '2026-10-23',
};
const clock = () => Date.parse('2026-10-22T12:00:00Z');
const emptyWeather = () => ({
  sources: [],
  issues: [],
  meta: {
    dailyForecast: [],
    tripDays: 2,
    forecastDaysMatched: 0,
    forecastCoverage: 'unavailable',
    forecastStatus: 'unavailable',
    floodStatus: 'unavailable',
    warnings: [],
  },
});
const row = (group) => ({
  url: `https://${group.id}.example.org/report`,
  title: 'Delhi traffic update',
  snippet: 'Delhi police report a road closure on Ring Road today.',
  publishedAt: '2026-10-22',
  group: group.id,
});
const fastExtract = async (rows) => ({
  results: new Map(
    rows.map((r) => [r.url, { text: r.snippet, publishedAt: r.publishedAt }]),
  ),
  errors: [],
  requestError: null,
});

test('one slow lane and a slow AI cannot discard completed evidence', async () => {
  const aborted = [];
  const scan = createAnalyzer({
    now: clock,
    stages: { search: 35, extraction: 35, weather: 35, assessment: 35 },
    search: async (group) => {
      if (group.id === 'health') {
        currentSignal().addEventListener('abort', () => aborted.push('search'));
        await sleep(10_000);
      }
      return [row(group)];
    },
    extract: fastExtract,
    weather: async () => emptyWeather(),
    assess: async () => {
      currentSignal().addEventListener('abort', () => aborted.push('AI'));
      await sleep(10_000);
    },
  });
  const started = performance.now();
  const result = await scan(trip);
  assert.ok(performance.now() - started < 600);
  assert.equal(result.sourceHealth.searchGroupsSucceeded, 7);
  assert.ok(result.sources.length > 0);
  assert.ok(result.issues.length > 0);
  assert.equal(result.analysisMode, 'rules');
  assert.ok(aborted.includes('search') && aborted.includes('AI'));
  assert.equal(result.performance.stages.assessment.status, 'timeout');
});

test('extraction starts before slow weather completes', async () => {
  let weatherFinished = false,
    extractedBeforeWeather = false;
  const scan = createAnalyzer({
    now: clock,
    stages: { search: 100, extraction: 100, weather: 100, assessment: 100 },
    search: async (g) => [row(g)],
    extract: async (rows) => {
      extractedBeforeWeather = !weatherFinished;
      return fastExtract(rows);
    },
    weather: async () => {
      await sleep(50);
      weatherFinished = true;
      return emptyWeather();
    },
    assess: async () => null,
  });
  await scan(trip);
  assert.equal(extractedBeforeWeather, true);
});

test('all unavailable providers return an honest usable response and are not cached', async () => {
  let calls = 0;
  const scan = createAnalyzer({
    now: clock,
    stages: { search: 25, extraction: 25, weather: 25, assessment: 25 },
    search: async () => {
      throw new Error('Provider quota exhausted');
    },
    weather: async () => {
      throw new Error('Weather down');
    },
    assess: async () => null,
  });
  const manager = createScanManager({
    run: async (args) => {
      calls++;
      return scan(args);
    },
  });
  for (let i = 0; i < 2; i++) {
    const result = await manager.request('same', trip);
    assert.equal(result.resultStatus, 'unavailable');
    assert.equal(result.coverageStatus, 'inconclusive');
    assert.equal(result.issues.length, 0);
    assert.ok(result.highlights.length && result.nextSteps.length);
    assert.equal(result.cached, false);
  }
  assert.equal(calls, 2);
});

test('snippets survive extraction failure as leads, not high-confidence alerts', async () => {
  const scan = createAnalyzer({
    now: clock,
    search: async (g) => [row(g)],
    extract: async () => {
      throw new Error('Fetch blocked');
    },
    weather: async () => emptyWeather(),
    assess: async () => null,
  });
  const result = await scan(trip);
  assert.equal(result.resultStatus, 'partial');
  assert.equal(result.issues.length, 0);
  assert.ok(result.leads.length > 0);
  assert.ok(result.leads.every((lead) => /snippet/.test(lead.reason)));
});

test('caller cancellation aborts all nested provider work', async () => {
  const aborted = [];
  const scan = createAnalyzer({
    search: async (g) => {
      currentSignal().addEventListener('abort', () => aborted.push(g.id));
      await sleep(10_000);
    },
    weather: async () => {
      await sleep(10_000);
      return emptyWeather();
    },
  });
  await assert.rejects(
    withRequestBudget(() => scan(trip), 20, 'Caller cancelled'),
    /Caller cancelled/,
  );
  assert.equal(aborted.length, 8);
});

test('cancelled queue entries never start and capacity remains available', async () => {
  const gate = createConcurrencyGate(1);
  let release;
  const busy = gate(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let ran = false;
  await assert.rejects(
    withRequestBudget(
      () =>
        gate(() => {
          ran = true;
        }),
      20,
      'Queue expired',
    ),
    /Queue expired/,
  );
  release();
  await busy;
  assert.equal(ran, false);
  assert.equal(await gate(async () => 42), 42);
});

test('provider JSON bodies are bounded while streaming', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ large: 'a'.repeat(1000) })),
  );
  await assert.rejects(
    fetchJson('https://example.com', { maxResponseBytes: 50 }),
    /size limit/,
  );
});

test('completed original pages survive an extraction deadline', async () => {
  const scan = createAnalyzer({
    now: clock,
    budgetMs: 2000,
    maxSources: 24,
    stages: { search: 30, extraction: 30, weather: 30, assessment: 30 },
    search: async (group) => [row(group)],
    weather: async () => emptyWeather(),
    assess: async () => null,
    extract: async (rows, { onPartial }) => {
      const results = new Map([
        [
          rows[0].url,
          { text: rows[0].snippet, publishedAt: rows[0].publishedAt },
        ],
      ]);
      onPartial({ results, errors: [] });
      await sleep(1000);
    },
  });
  const result = await scan(trip);
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.performance.budgetMs, 2000);
  assert.ok(result.sources.some((s) => s.fetched));
  assert.ok(result.nextSteps.length);
});
