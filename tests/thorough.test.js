import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNewsFeed, searchThorough } from '../server/thorough-search.js';
import { createTripService } from '../server/trip-service.js';
import { createTripStore } from '../server/trip-store.js';
const config = {
  title: 'Thorough test',
  stops: [
    {
      id: 'delhi',
      location: {
        name: 'Delhi',
        admin1: 'Delhi',
        latitude: 28.6,
        longitude: 77.2,
      },
      startDate: '2026-10-23',
      endDate: '2026-10-24',
    },
  ],
  preferences: { mode: 'car' },
  watch: { enabled: false, frequencyHours: 6, alertLevel: 'all' },
};
test('news feeds stay source leads, reject wrong places and unsafe links', () => {
  const group = {
    id: 'regional-news',
    context: { city: 'Delhi', region: 'Delhi', aliases: ['Delhi'] },
  };
  const rss =
    '<rss><channel><item><title>Delhi road closure announced</title><link>https://news.example.com/delhi</link><description>Delhi traffic police closed the road.</description><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Mumbai road closure</title><link>https://news.example.com/mumbai</link></item><item><title>Delhi road closure</title><link>http://127.0.0.1/private</link></item></channel></rss>';
  const rows = parseNewsFeed(rss, group);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].searchMode, 'independent-news-feed');
  assert.ok(!rows[0].fetched);
});
test('independent news retrieval works when TinyFish is not configured', async (t) => {
  const native = globalThis.fetch,
    prior = process.env.TINYFISH_API_KEY;
  delete process.env.TINYFISH_API_KEY;
  t.after(() => {
    globalThis.fetch = native;
    if (prior === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = prior;
  });
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).hostname, 'news.google.com');
    return new Response(
      '<rss><channel><item><title>Delhi road closure advisory</title><link>https://news.example.com/advisory</link><description>Delhi traffic diversion announced.</description></item></channel></rss>',
    );
  };
  const rows = await searchThorough({
    id: 'regional-news',
    context: { city: 'Delhi', region: 'Delhi', aliases: ['Delhi'] },
  });
  assert.equal(rows.length, 1);
  assert.equal(
    rows.providers.find((p) => p.provider === 'Google News RSS').status,
    'checked',
  );
  assert.equal(rows.providers[0].status, 'unavailable');
});
test('thorough checks get longer leases, fresh work and actual progress', async () => {
  let time = Date.parse('2026-10-23T12:00Z');
  const store = createTripStore({ now: () => time }),
    workspace = store.createWorkspace().workspace,
    trip = store.create(workspace.id, config);
  const calls = [];
  let unblock;
  const service = createTripService({
    store,
    now: () => time,
    routes: async () => ({ routes: [], notes: [] }),
    scan: async (args) => {
      calls.push(args.scanMode);
      args.onProgress?.('Reading original reports');
      if (args.scanMode === 'thorough')
        await new Promise((r) => {
          unblock = r;
        });
      return {
        issues: [],
        sources: [],
        nextSteps: [],
        resultStatus: 'available',
        weather: {},
      };
    },
  });
  try {
    await service.check(workspace.id, trip.id);
    await service.idle();
    await service.check(workspace.id, trip.id, { scanMode: 'thorough' });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls, ['quick', 'thorough']);
    assert.equal(
      service.progress(workspace.id, trip.id).phase,
      'Reading original reports',
    );
    time += 181000;
    assert.equal(store.get(workspace.id, trip.id).checking, true);
    await assert.rejects(service.check(workspace.id, trip.id), /already/);
    unblock();
    await service.idle();
    assert.equal(store.get(workspace.id, trip.id).latest.scanMode, 'thorough');
    assert.equal(service.progress(workspace.id, trip.id), null);
    await assert.rejects(
      service.check(workspace.id, trip.id, { scanMode: 'invalid' }),
      /Choose/,
    );
  } finally {
    await service.stop();
    store.close();
  }
});
