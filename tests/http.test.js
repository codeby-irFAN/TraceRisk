import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fetchJson, sleep, withRequestBudget } from '../server/http.js';
import { scoreWithAI } from '../server/assessment.js';

test('HTTP failures, provider fallback and cancellation', async (t) => {
  let rateRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/rate') {
      rateRequests += 1;
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '2',
      });
      res.end(JSON.stringify({ error: { message: 'Quota exceeded' } }));
    } else if (req.url === '/invalid') {
      res.end('not JSON');
    } else if (req.url === '/slow') {
      req.on('close', () => res.destroy());
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test(
    'rate-limit retries can be disabled for immediate provider fallback',
    async () => {
      await assert.rejects(
        fetchJson(`${base}/rate`, { retryRateLimit: false }),
        (error) => {
          assert.equal(error.status, 429);
          assert.equal(error.retryAfterMs, 2000);
          return true;
        },
      );
      assert.equal(rateRequests, 1);
    },
  );

  await t.test(
    'successful malformed responses are not treated as data',
    async () => {
      await assert.rejects(fetchJson(`${base}/invalid`), /invalid JSON/);
    },
  );

  await t.test(
    'individual request timeouts abort pending fetches',
    async () => {
      await assert.rejects(fetchJson(`${base}/slow`, {}, 30), {
        name: 'TimeoutError',
      });
    },
  );

  await t.test(
    'overall scan budget cancels upstream work and retry delays',
    async () => {
      let aborted = false;
      const originalFetch = globalThis.fetch;
      t.mock.method(
        globalThis,
        'fetch',
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      );
      await assert.rejects(
        withRequestBudget(
          () => fetchJson('https://example.com'),
          30,
          'Scan budget exhausted',
        ),
        /Scan budget exhausted/,
      );
      assert.equal(aborted, true);
      globalThis.fetch = originalFetch;
      await assert.rejects(
        withRequestBudget(() => sleep(10_000), 30, 'Scan budget exhausted'),
        /Scan budget exhausted/,
      );
    },
  );

  await t.test(
    'Groq is the only AI endpoint; quota failures are not retried and missing keys skip AI',
    async () => {
      const previous = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-only';
      const calls = [];
      let quotaFailure = false;
      const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push(String(url));
        assert.equal(options.headers.Authorization, 'Bearer test-only');
        assert.equal(
          JSON.parse(options.body).response_format.type,
          'json_object',
        );
        if (quotaFailure)
          return Response.json(
            { error: { message: 'Quota exceeded' } },
            { status: 429 },
          );
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ claims: [] }) } }],
        });
      });
      const args = {
        destination: 'Delhi',
        startDate: '2026-10-22',
        endDate: '2026-10-23',
        sources: [],
      };
      try {
        const result = await scoreWithAI(args);
        assert.equal(result._providerUsed, 'Groq');
        assert.equal(result._fallbackReason, null);
        assert.deepEqual(calls, [
          'https://api.groq.com/openai/v1/chat/completions',
        ]);
        quotaFailure = true;
        await assert.rejects(scoreWithAI(args), /Groq:.*Quota exceeded/);
        assert.equal(calls.length, 2);
        delete process.env.GROQ_API_KEY;
        assert.equal(await scoreWithAI(args), null);
        assert.equal(calls.length, 2);
      } finally {
        mock.mock.restore();
        if (previous === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previous;
      }
    },
  );
});
