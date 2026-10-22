import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { createTripStore } from '../server/trip-store.js';
import { passwordHash, passwordMatches } from '../server/auth.js';
import { knownLandmarks, photonPlaces } from '../server/places.js';
import { findDestinationLocations } from '../server/locations.js';
import { placeContext, placeMatch } from '../server/evidence.js';
import { buildQueries } from '../server/search.js';
import {
  answerTripQuestion,
  coverageChecks,
} from '../server/trip-intelligence.js';
const pass = 'correct-horse-travel-41';
test('passwords have unique salts and verify without storing plaintext', async () => {
  const a = await passwordHash(pass),
    b = await passwordHash(pass);
  assert.notEqual(a, b);
  assert.ok(!a.includes(pass));
  assert.equal(await passwordMatches(pass, a), true);
  assert.equal(await passwordMatches('wrong password', a), false);
});
test('accounts, session cookies, access isolation, migration and password changes', async (t) => {
  let now = Date.parse('2026-10-22T12:00Z');
  const store = createTripStore({ now: () => now });
  const old = store.createWorkspace();
  const app = createApp({ tripStore: store });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => {
    await app.locals.tripService.stop();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, body, cookie, extra = {}) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TraceRisk-Request': '1',
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const registered = await request('/auth/register', {
    name: 'Traveller',
    email: 'Me@Example.com',
    password: pass,
    legacyKey: old.key,
  });
  assert.equal(registered.status, 201);
  const profile = await registered.json(),
    cookie = registered.headers.get('set-cookie').split(';')[0];
  assert.equal(profile.user.email, 'me@example.com');
  assert.equal(profile.user.workspaceId, old.workspace.id);
  assert.ok(!('key' in profile));
  assert.match(registered.headers.get('set-cookie'), /HttpOnly/);
  assert.match(registered.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(
    (await (await request('/workspace', undefined, cookie)).json()).workspace
      .id,
    old.workspace.id,
  );
  assert.equal(
    (
      await request('/trips', undefined, undefined, {
        Authorization: `Bearer ${old.key}`,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/auth/login', {
        email: 'me@example.com',
        password: 'wrong',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/auth/register', {
        name: 'Other',
        email: 'me@example.com',
        password: pass,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/auth/logout', {}, cookie, {
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  );
  const noCsrf = await fetch(base + '/auth/logout', {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(noCsrf.status, 403);
  const changed = await request(
    '/auth/password',
    { currentPassword: pass, newPassword: pass + 'new' },
    cookie,
  );
  assert.equal(changed.status, 200);
  const newCookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/trips', undefined, cookie)).status, 401);
  assert.equal((await request('/trips', undefined, newCookie)).status, 200);
  await request('/auth/logout', {}, newCookie);
  assert.equal((await request('/trips', undefined, newCookie)).status, 401);
  const login = await request('/auth/login', {
    email: 'ME@example.com',
    password: pass + 'new',
  });
  assert.equal(login.status, 200);
  const finalCookie = login.headers.get('set-cookie').split(';')[0];
  now += 15 * 86400000;
  assert.equal((await request('/trips', undefined, finalCookie)).status, 401);
  assert.equal((await request('/workspaces', {})).status, 404);
});
test('landmark lookup preserves coordinates and surrounding-city relevance', async () => {
  const hawa = (await findDestinationLocations('Hawa Mahal, Jaipur'))[0];
  assert.equal(hawa.name, 'Hawa Mahal');
  assert.equal(hawa.city, 'Jaipur');
  assert.equal(hawa.kind, 'landmark');
  assert.equal(knownLandmarks('Qutb Minar')[0].name, 'Qutub Minar');
  assert.equal(knownLandmarks('Hawa Mahal, Delhi').length, 0);
  const context = placeContext('Hawa Mahal, Jaipur', hawa);
  assert.equal(context.city, 'Jaipur');
  assert.equal(placeMatch('Jaipur traffic restrictions', context), 'city');
  assert.equal(placeMatch('Hawa Mahal entry closure', context), 'city');
  assert.ok(
    buildQueries('Hawa Mahal, Jaipur', '', '', hawa)
      .find((x) => x.id === 'regional-news')
      .query.includes('Hawa Mahal'),
  );
  const found = photonPlaces({
    features: [
      {
        geometry: { coordinates: [77.18, 28.52] },
        properties: {
          name: 'Qutub Minar',
          city: 'Delhi',
          state: 'Delhi',
          countrycode: 'IN',
          osm_value: 'attraction',
        },
      },
      {
        geometry: { coordinates: [500, 0] },
        properties: { name: 'Bad', countrycode: 'IN' },
      },
    ],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'landmark');
  assert.equal(found[0].latitude, 28.52);
});
test('assistant answers weather from forecasts, handles itinerary dates and does not invent attraction hours', () => {
  const trip = {
    preferences: { mode: 'car' },
    stops: [
      {
        location: { name: 'Hawa Mahal', city: 'Jaipur' },
        startDate: '2026-10-22',
        endDate: '2026-10-23',
      },
    ],
    timeline: [],
    latest: {
      checkedAt: '2026-10-22T12:00Z',
      reports: [
        {
          label: 'Hawa Mahal, Jaipur',
          location: { name: 'Hawa Mahal', city: 'Jaipur' },
          startDate: '2026-10-22',
          endDate: '2026-10-23',
          result: {
            issues: [],
            sources: [
              {
                id: 'W1',
                title: 'Weather forecast',
                url: 'https://api.open-meteo.com/v1/forecast',
                group: 'weather-api',
              },
            ],
            weather: {
              dailyForecast: [
                {
                  date: '2026-10-23',
                  condition: 'Clear sky',
                  minC: 22,
                  maxC: 32,
                  precipitationMm: 0,
                },
              ],
            },
            nextSteps: [],
          },
        },
      ],
    },
  };
  const now = Date.parse('2026-10-22T12:00Z');
  const weather = answerTripQuestion(
    trip,
    'What is the weather tomorrow?',
    now,
  );
  assert.match(weather.answer, /Clear sky/);
  assert.equal(weather.citations.length, 1);
  assert.match(
    answerTripQuestion(trip, 'Weather on 2026-10-29?', now).answer,
    /do not cover/,
  );
  assert.match(
    answerTripQuestion(trip, 'Hawa Mahal opening hours?', now).answer,
    /do not have verified opening hours/,
  );
  assert.match(
    answerTripQuestion(trip, 'Show my itinerary', now).answer,
    /Hawa Mahal, Jaipur/,
  );
  assert.ok(!JSON.stringify(coverageChecks({})).includes('CPCB'));
  assert.ok(!JSON.stringify(coverageChecks({})).includes('all-clear'));
});

test('accounts and session hashes persist after reopening the database', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'),
    { join } = await import('node:path'),
    { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'tracerisk-auth-')),
    filename = join(dir, 'auth.sqlite');
  let store = createTripStore({ filename });
  try {
    const workspace = store.createWorkspace().workspace;
    const account = store.accounts.create({
      id: 'persisted-user',
      email: 'persist@example.com',
      name: 'Persisted',
      passwordHash: await passwordHash(pass),
      workspace: workspace.id,
    });
    const token = store.accounts.session(account.id);
    store.close();
    store = createTripStore({ filename });
    assert.equal(
      store.accounts.authenticate(token).email,
      'persist@example.com',
    );
    assert.equal(
      await passwordMatches(
        pass,
        store.accounts.find('persist@example.com').password_hash,
      ),
      true,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an existing account can import an unclaimed legacy workspace without losing its trips', () => {
  const store = createTripStore();
  try {
    const old = store.createWorkspace(),
      current = store.createWorkspace();
    store.accounts.create({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'unused',
      workspace: current.workspace.id,
    });
    const trip = store.create(old.workspace.id, {
      title: 'Old trip',
      stops: [{ endDate: '2026-10-23' }],
      watch: { enabled: false, frequencyHours: 6 },
    });
    assert.equal(store.importLegacy(old.key, current.workspace.id), true);
    assert.equal(store.get(current.workspace.id, trip.id).title, 'Old trip');
    assert.equal(store.authenticate(old.key), null);
    const claimed = store.createWorkspace();
    store.accounts.create({
      id: 'other',
      name: 'Other',
      email: 'other@example.com',
      passwordHash: 'unused',
      workspace: claimed.workspace.id,
    });
    assert.equal(store.importLegacy(claimed.key, current.workspace.id), false);
  } finally {
    store.close();
  }
});
