import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRateLimiter,
  createScanManager,
} from '../server/scan-manager.js';
import { sleep } from '../server/http.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('rate limits expire and do not evict active clients to bypass the limit', () => {
  let time = 0;
  const limiter = createRateLimiter({
    limit: 2,
    windowMs: 1000,
    maxClients: 1,
    now: () => time,
  });
  limiter.consume('first');
  limiter.consume('first');
  assert.throws(
    () => limiter.consume('first'),
    (error) => error.status === 429 && error.retryAfterSeconds === 1,
  );
  assert.throws(() => limiter.consume('other'), { code: 'RATE_LIMITED' });
  time = 1001;
  limiter.consume('other');
});

test('identical active scans share one job, while unrelated work respects capacity', async () => {
  const started = deferred();
  const finished = deferred();
  let calls = 0;
  const manager = createScanManager({
    maxConcurrent: 1,
    run: async () => {
      calls += 1;
      started.resolve();
      return finished.promise;
    },
  });
  const first = manager.request('same', {}, { client: 'first' });
  await started.promise;
  const second = manager.request('same', {}, { client: 'second' });
  await assert.rejects(manager.request('different', {}, { client: 'third' }), {
    code: 'SCAN_CAPACITY',
    status: 429,
  });
  finished.resolve({ destination: 'Delhi' });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.shared, false);
  assert.equal(b.shared, true);
  assert.equal(b.destination, 'Delhi');
  const cached = await manager.request('same', {}, { client: 'first' });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
});

test('cancelling one subscriber preserves shared work; cancelling the last aborts it', async () => {
  const started = deferred();
  const aborted = deferred();
  let stopped = false;
  const manager = createScanManager({
    run: async () => {
      started.resolve();
      try {
        await sleep(10_000);
      } catch (error) {
        stopped = true;
        aborted.resolve();
        throw error;
      }
      return { ok: true };
    },
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = manager.request('same', {}, { client: 'a', signal: a.signal });
  const second = manager.request('same', {}, { client: 'b', signal: b.signal });
  await started.promise;
  a.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(stopped, false);
  b.abort();
  await assert.rejects(second, { name: 'AbortError' });
  await aborted.promise;
  assert.equal(stopped, true);
});

test('cancelled and failed jobs release capacity and are never cached', async () => {
  let calls = 0;
  const manager = createScanManager({
    maxConcurrent: 1,
    run: async () => {
      calls += 1;
      throw new Error('Provider failed');
    },
  });
  await assert.rejects(manager.request('same', {}), /Provider failed/);
  await assert.rejects(manager.request('same', {}), /Provider failed/);
  assert.equal(calls, 2);
});

test('the overall timeout releases a scan slot', async () => {
  const manager = createScanManager({
    maxConcurrent: 1,
    budgetMs: 20,
    run: async (fast) => {
      if (!fast) await sleep(1000);
      return { ok: true };
    },
  });
  await assert.rejects(manager.request('slow', false), {
    name: 'TimeoutError',
  });
  assert.equal((await manager.request('fast', true)).ok, true);
});
