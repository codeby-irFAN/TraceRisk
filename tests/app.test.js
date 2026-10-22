import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../server/app.js';

test('API validation and a complete scan with fixture providers', async (t) => {
  const nativeFetch = globalThis.fetch;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const post = (body) =>
    nativeFetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const trip = {
    destination: 'Delhi',
    startDate: '2026-10-22',
    endDate: '2026-10-23',
  };

  await t.test(
    'health reports provider status without exposing credentials',
    async () => {
      const response = await nativeFetch(`${base}/api/health`);
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.ok, true);
      assert.equal(health.service, 'TraceRisk API');
      assert.equal(typeof health.tinyfishConfigured, 'boolean');
      assert.equal(typeof health.weatherProxyMode, 'string');
      assert.ok(
        !Object.keys(health).some((key) => /api.?key|token/i.test(key)),
      );
    },
  );

  await t.test(
    'rejects invalid input without invoking external providers',
    async () => {
      for (const body of [
        {},
        { ...trip, destination: {} },
        { ...trip, startDate: '2026-02-30' },
        { ...trip, startDate: '2026-10-22junk' },
        { ...trip, endDate: '2026-10-21' },
        { ...trip, endDate: '2027-02-01' },
      ]) {
        const response = await post(body);
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error, 'string');
      }
      const malformed = await nativeFetch(`${base}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      assert.equal(malformed.status, 400);
      assert.match((await malformed.json()).error, /valid JSON/);
      const oversized = await post({ ...trip, padding: 'x'.repeat(33_000) });
      assert.equal(oversized.status, 413);
      const missing = await nativeFetch(`${base}/api/missing`);
      assert.equal(missing.status, 404);
      assert.match((await missing.json()).error, /not found/);
    },
  );

  await t.test(
    'still requires a confirmed place when the search credential is missing',
    async () => {
      const previous = process.env.TINYFISH_API_KEY;
      delete process.env.TINYFISH_API_KEY;
      try {
        const response = await post(trip);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'LOCATION_REQUIRED');
      } finally {
        if (previous !== undefined) process.env.TINYFISH_API_KEY = previous;
      }
    },
  );

  await t.test(
    'collects evidence, derives trip-date signals, and caches the scan',
    async () => {
      const keys = ['TINYFISH_API_KEY', 'GROQ_API_KEY'];
      const previous = Object.fromEntries(
        keys.map((key) => [key, process.env[key]]),
      );
      process.env.TINYFISH_API_KEY = 'test-only';
      delete process.env.GROQ_API_KEY;
      let externalCalls = 0;
      let searchCalls = 0;
      const mock = t.mock.method(
        globalThis,
        'fetch',
        async (input, options) => {
          const url = new URL(input);
          if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
          externalCalls += 1;
          if (url.hostname === 'api.search.tinyfish.ai') {
            searchCalls += 1;
            return Response.json({
              results: [
                {
                  url: `https://news${searchCalls}.example.org/closure`,
                  title: 'Delhi traffic advisory',
                  snippet:
                    'Current Delhi road closure and traffic diversion. Verify with local police.',
                  date: new Date().toISOString(),
                },
              ],
            });
          }
          if (url.hostname === 'api.fetch.tinyfish.ai')
            return Response.json({
              results: JSON.parse(options.body).urls.map((sourceUrl) => ({
                url: sourceUrl,
                text: 'Current Delhi road closure and traffic diversion. Check local transport advisories.',
              })),
            });
          if (url.hostname === 'geocoding-api.open-meteo.com')
            return Response.json({
              results: [
                {
                  name: 'Delhi',
                  country_code: 'IN',
                  latitude: 28.61,
                  longitude: 77.21,
                },
              ],
            });
          if (url.hostname === 'api.open-meteo.com')
            return Response.json({
              daily: {
                time: ['2026-10-21', '2026-10-22', '2026-10-23'],
                temperature_2m_max: [45, 31, 32],
                precipitation_sum: [100, 60, 0],
                weather_code: [99, 65, 0],
              },
            });
          if (url.hostname === 'flood-api.open-meteo.com')
            return Response.json({ daily: { time: [] } });
          throw new Error(`Unexpected provider: ${url.hostname}`);
        },
      );
      try {
        const lookup = await nativeFetch(
          `${base}/api/locations?destination=Delhi`,
        );
        assert.equal(lookup.status, 200);
        const { locations } = await lookup.json();
        assert.equal(locations.length, 1);
        trip.locationId = locations[0].id;
        const response = await post(trip);
        assert.equal(response.status, 200);
        const scan = await response.json();
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-request-id'), scan.requestId);
        assert.match(response.headers.get('server-timing'), /scan;dur=/);
        assert.equal(scan.analysisMode, 'rules');
        assert.equal(scan.searchLaneStats.length, 8);
        assert.equal(scan.pagesFetched, 3);
        assert.equal(scan.sourceHealth.searchGroupsSucceeded, 8);
        assert.equal(scan.coverageStatus, 'limited');
        assert.equal(scan.sourceHealth.publisherCount, 1);
        assert.ok(scan.highlights.length > 0);
        assert.equal(scan.hasIssues, true);
        assert.ok(
          scan.issues.some(
            (issue) => issue.title === 'Heavy rainfall forecast signal',
          ),
        );
        assert.ok(
          !scan.issues.some((issue) => /heat|thunderstorm/i.test(issue.title)),
        );
        assert.deepEqual(
          scan.weather.dailyForecast.map((day) => day.date),
          ['2026-10-22', '2026-10-23'],
        );
        const ids = new Set(scan.sources.map((source) => source.id));
        assert.ok(
          scan.issues.every((issue) =>
            issue.sourceIds.every((id) => ids.has(id)),
          ),
        );
        const before = externalCalls;
        const cached = await post(trip);
        assert.equal((await cached.json()).cached, true);
        assert.equal(externalCalls, before);
        // A distinct scan with no search credential must still return available weather.
        delete process.env.TINYFISH_API_KEY;
        const searchesBefore = searchCalls;
        const weatherOnly = await post({ ...trip, endDate: '2026-10-24' });
        assert.equal(weatherOnly.status, 200);
        const partial = await weatherOnly.json();
        assert.equal(partial.resultStatus, 'partial');
        assert.equal(partial.coverageStatus, 'inconclusive');
        assert.equal(partial.weather.forecastDaysMatched, 2);
        assert.ok(partial.nextSteps.length > 0);
        assert.equal(partial.sourceHealth.searchGroupsSucceeded, 0);
        assert.equal(searchCalls, searchesBefore);
      } finally {
        mock.mock.restore();
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  );
});
