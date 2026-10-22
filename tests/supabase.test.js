import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseStore } from '../server/supabase-store.js';
import { supabaseAuth } from '../server/supabase-auth.js';
import { createApp } from '../server/app.js';
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const config = {
  title: 'Saved Supabase trip',
  stops: [
    {
      location: { name: 'Delhi', latitude: 28.6, longitude: 77.2 },
      startDate: '2026-10-23',
      endDate: '2026-10-24',
    },
  ],
  preferences: { mode: 'car' },
  watch: { enabled: true, frequencyHours: 6 },
  latest: null,
  timeline: [],
};
test('actual PostgreSQL migration enforces ownership, atomic revisions, locks and public-share expiry', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema auth to authenticated,anon,service_role;insert into auth.users values('${A}'),('${B}');`,
    );
    const sql = await readFile(
      new URL(
        '../supabase/migrations/202610230001_tracerisk.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.exec(sql);
    await db.exec(sql);
    const actor = async (id, role = 'authenticated') => {
      await db.exec(`reset role;set role ${role};`);
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
        [id, role],
      );
    };
    const call = async (action, args = {}) =>
      (
        await db.query('select public.tracerisk_store($1,$2::jsonb) as value', [
          action,
          JSON.stringify(args),
        ])
      ).rows[0].value;
    const serverCall = async (action, args = {}) => {
      await actor('', 'service_role');
      try {
        return await call(action, { workspace: A, ...args });
      } finally {
        await actor(A);
      }
    };
    await actor(A);
    assert.equal((await call('workspace')).id, A);
    const trip = await serverCall('create', { value: config });
    assert.equal(trip.title, config.title);
    assert.equal((await call('list')).length, 1);
    assert.equal(await serverCall('claim', { id: trip.id }), true);
    assert.equal(await serverCall('claim', { id: trip.id }), false);
    await serverCall('release', { id: trip.id });
    assert.equal(
      await serverCall('claimLong', { id: trip.id, leaseMs: 540000 }),
      true,
    );
    await db.exec('reset role');
    const longLock = (
      await db.query(
        'select lock_until - extract(epoch from clock_timestamp())*1000 as remaining from public.tracerisk_trips where id=$1',
        [trip.id],
      )
    ).rows[0];
    assert.ok(Number(longLock.remaining) > 500000);
    await actor(A);
    await serverCall('release', { id: trip.id });
    const patched = await serverCall('update', {
      id: trip.id,
      revision: trip.revision,
      patch: { latest: { reports: [] } },
    });
    assert.equal(patched.revision, 2);
    await assert.rejects(
      call('update', {
        id: trip.id,
        revision: 2,
        patch: { latest: { forged: true } },
      }),
      /Server access required/,
    );
    await assert.rejects(
      serverCall('update', { id: trip.id, revision: 1, patch: {} }),
      /changed/,
    );
    const hash = 'a'.repeat(64);
    await serverCall('share', {
      id: trip.id,
      keyHash: hash,
      snapshot: { title: 'Frozen public copy' },
    });
    await actor(B);
    await call('workspace');
    assert.deepEqual(await call('list'), []);
    assert.equal(await call('get', { id: trip.id }), null);
    await assert.rejects(call('get', { id: trip.id, workspace: A }), /denied/);
    await assert.rejects(
      call('remove', { id: trip.id }),
      /Server access required/,
    );
    await assert.rejects(
      db.query('select * from public.tracerisk_trips'),
      /permission denied/,
    );
    await actor('', 'anon');
    const shared = await db.query(
      'select public.tracerisk_read_share($1) as value',
      [hash],
    );
    assert.equal(shared.rows[0].value.title, 'Frozen public copy');
    await assert.rejects(call('list'), /permission denied/);
    await actor(A);
    await assert.rejects(call('due'), /denied/);
    await serverCall('revoke', { id: trip.id });
    assert.equal(
      (
        await db.query('select public.tracerisk_read_share($1) as value', [
          hash,
        ])
      ).rows[0].value,
      null,
    );
    const expiredHash = 'b'.repeat(64);
    await serverCall('share', {
      id: trip.id,
      keyHash: expiredHash,
      snapshot: { title: 'Expired' },
    });
    await db.exec('reset role');
    await db.query(
      'update public.tracerisk_shares set expires=0 where key_hash=$1',
      [expiredHash],
    );
    await actor('', 'anon');
    assert.equal(
      (
        await db.query('select public.tracerisk_read_share($1) as value', [
          expiredHash,
        ])
      ).rows[0].value,
      null,
    );
    await actor('', 'service_role');
    assert.ok(Array.isArray(await call('due')));
  } finally {
    await db.close();
  }
});
test('Supabase adapter scopes concurrent user JWTs without a service secret', async () => {
  const calls = [];
  const clientFactory = (_url, key, options) => ({
    rpc: async (action, args) => {
      calls.push({
        action,
        args,
        token: options.global?.headers?.Authorization,
        key,
      });
      await new Promise((r) => setTimeout(r, 1));
      return {
        data: action === 'tracerisk_read_share' ? null : [],
        error: null,
      };
    },
  });
  const store = createSupabaseStore({
    url: 'https://example.supabase.co',
    publishableKey: 'public-key',
    clientFactory,
  });
  assert.equal(store.monitoringAvailable, false);
  await Promise.all([
    store.runWithToken('user-a', () => store.list(A)),
    store.runWithToken('user-b', () => store.list(B)),
  ]);
  assert.deepEqual(
    calls.map((c) => c.token),
    ['Bearer user-a', 'Bearer user-b'],
  );
  await assert.rejects(store.list(A), /sign in/);
  assert.deepEqual(store.due(), []);
});
test('Supabase email confirmation does not sign in prematurely; recovery validates the callback grant', async (t) => {
  const mock = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      signUp: async () => ({
        data: { user: { id: A, email: 'test@example.com' }, session: null },
        error: null,
      }),
      resetPasswordForEmail: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({
        data: { session: { access_token: 'verified-session' } },
        error: null,
      }),
    },
  };
  const auth = supabaseAuth({
    url: 'https://example.supabase.co',
    publishableKey: 'public',
    siteUrl: 'https://tracerisk.onrender.com',
    clientFactory: () => mock,
  });
  const app = createApp({ auth });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    app.locals.tripStore.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + '/api/auth/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TraceRisk-Request': '1',
      },
      body: JSON.stringify(body),
    });
  const register = await post('register', {
    name: 'Test',
    email: 'test@example.com',
    password: 'a-valid-password-123',
  });
  const body = await register.json();
  assert.equal(body.user, null);
  assert.equal(body.confirmationRequired, true);
  assert.equal(
    (await post('reset-password', { newPassword: 'a-new-password-123' }))
      .status,
    401,
  );
  const reset = await post('forgot-password', { email: 'test@example.com' });
  assert.equal(reset.status, 200);
  assert.match(reset.headers.get('set-cookie'), /HttpOnly/);
  const callback = await fetch(
    base + '/auth/callback?code=code&recovery=forged',
    { redirect: 'manual' },
  );
  assert.equal(callback.headers.get('location'), '/?authError=link');
});

test('trip API retains the verified Supabase token across asynchronous middleware', async (t) => {
  const tokens = [];
  const store = createSupabaseStore({
    url: 'https://example.supabase.co',
    publishableKey: 'public',
    clientFactory: (_url, _key, options) => ({
      rpc: async (_fn, { action }) => {
        tokens.push(options.global.headers?.Authorization);
        await new Promise((r) => setTimeout(r, 1));
        return {
          data: action === 'workspace' ? { id: A, agencyName: 'Desk' } : [],
          error: null,
        };
      },
    }),
  });
  const express = (await import('express')).default;
  const auth = {
    router: express.Router(),
    account: async (req) => {
      req.supabaseAccessToken = 'verified-token';
      return { id: A, workspaceId: A };
    },
    callback: (_req, res) => res.end(),
  };
  const app = createApp({ tripStore: store, auth });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/trips`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).trips, []);
  assert.deepEqual(tokens, ['Bearer verified-token', 'Bearer verified-token']);
});

test('Google login uses a real PKCE authorization URL and HttpOnly verifier cookie', async (t) => {
  const native = globalThis.fetch;
  let enabled = true;
  globalThis.fetch = async (input, init) =>
    new URL(input).hostname === 'example.supabase.co'
      ? new Response(JSON.stringify({ external: { google: enabled } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      : native(input, init);
  t.after(() => {
    globalThis.fetch = native;
  });
  const auth = supabaseAuth({
      url: 'https://example.supabase.co',
      publishableKey: 'public-test-key',
      siteUrl: 'https://tracerisk.onrender.com',
    }),
    app = createApp({ auth }),
    server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    app.locals.tripStore.close();
  });
  const post = () =>
    native(`http://127.0.0.1:${server.address().port}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TraceRisk-Request': '1',
      },
      body: '{}',
    });
  const response = await post();
  assert.equal(response.status, 200);
  const target = new URL((await response.json()).url);
  assert.equal(target.origin, 'https://example.supabase.co');
  assert.equal(target.searchParams.get('provider'), 'google');
  assert.ok(target.searchParams.get('code_challenge'));
  assert.equal(
    target.searchParams.get('redirect_to'),
    'https://tracerisk.onrender.com/auth/callback',
  );
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  enabled = false;
  assert.equal((await post()).status, 503);
});
