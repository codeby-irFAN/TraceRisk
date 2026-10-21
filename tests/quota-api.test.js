import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { createLocationResolver } from '../server/locations.js';

test('API enforces confirmed locations, coalesces scans, and returns quota headers', async (t) => {
  const oldKey = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'test-only';
  t.after(() => {
    if (oldKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = oldKey;
  });
  let release;
  let started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  let scans = 0;
  const resolver = createLocationResolver({
    search: async () => [
      {
        name: 'Rampur',
        admin1: 'Uttar Pradesh',
        country: 'India',
        latitude: 28.8,
        longitude: 79,
      },
      {
        name: 'Rampur',
        admin1: 'Himachal Pradesh',
        country: 'India',
        latitude: 31.4,
        longitude: 77.6,
      },
    ],
  });
  const app = createApp({
    locationResolver: resolver,
    scanOptions: { rateLimit: 3, maxConcurrent: 1 },
    scan: async (args) => {
      scans += 1;
      assert.equal(args.location.admin1, 'Himachal Pradesh');
      assert.equal(args.destination, 'Rampur, Himachal Pradesh, India');
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return { destination: args.destination, issues: [], sources: [] };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const locations = (
    await (await fetch(`${base}/api/locations?destination=Rampur`)).json()
  ).locations;
  const trip = {
    destination: 'Rampur',
    startDate: '2026-10-22',
    endDate: '2026-10-23',
  };
  const post = (body, forwarded) =>
    fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post(trip)).status, 400);
  assert.equal(
    (
      await post({
        ...trip,
        locationId: 'invented',
        location: { latitude: 0, longitude: 0 },
      })
    ).status,
    400,
  );
  const confirmed = { ...trip, locationId: locations[1].id };
  const a = post(confirmed);
  await waiting;
  let b;
  await new Promise((resolve) => {
    server.once('request', resolve);
    b = post(confirmed);
  });
  const busy = await post({ ...confirmed, endDate: '2026-10-24' });
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).code, 'SCAN_CAPACITY');
  assert.ok(Number(busy.headers.get('retry-after')) > 0);
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.status, 200);
  assert.equal((await second.json()).shared, true);
  assert.equal(scans, 1);
  const limited = await post(confirmed, '203.0.113.1');
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
