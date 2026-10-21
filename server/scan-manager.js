import { withRequestBudget } from './http.js';
import { trimCache } from './utils.js';

function busyError(message, code, retryAfterSeconds) {
  return Object.assign(new Error(message), {
    status: 429,
    code,
    retryAfterSeconds,
  });
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxClients = 10_000,
}) {
  const clients = new Map();
  return {
    consume(key) {
      const time = now();
      let entry = clients.get(key);
      if (!entry || entry.resetAt <= time) {
        if (clients.size >= maxClients) {
          for (const [client, bucket] of clients)
            if (bucket.resetAt <= time) clients.delete(client);
          if (!clients.has(key) && clients.size >= maxClients)
            throw busyError(
              'Too many requests. Please try again shortly.',
              'RATE_LIMITED',
              60,
            );
        }
        entry = { count: 0, resetAt: time + windowMs };
        clients.set(key, entry);
      }
      if (entry.count >= limit)
        throw busyError(
          'Request limit reached. Please wait before trying again.',
          'RATE_LIMITED',
          Math.max(1, Math.ceil((entry.resetAt - time) / 1000)),
        );
      entry.count += 1;
    },
  };
}

export function createScanManager({
  run,
  maxConcurrent = 3,
  maxSubscribers = 100,
  rateLimit = 6,
  rateWindowMs = 10 * 60_000,
  cacheTtlMs = 45_000,
  maxCacheEntries = 100,
  budgetMs = 100_000,
  timeoutMessage = 'The scan exceeded its time limit. Please try again.',
  now = Date.now,
}) {
  const jobs = new Map();
  const cache = new Map();
  const limiter = createRateLimiter({
    limit: rateLimit,
    windowMs: rateWindowMs,
    now,
  });

  function subscribe(job, signal) {
    const subscriber = Symbol();
    job.subscribers.add(subscriber);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        job.subscribers.delete(subscriber);
        if (!job.settled && job.subscribers.size === 0) job.controller.abort();
        callback(value);
      };
      const onAbort = () => finish(reject, signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      job.promise.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
      if (signal?.aborted) onAbort();
    });
  }

  return {
    async request(key, args, { client = 'unknown', signal } = {}) {
      signal?.throwIfAborted();
      limiter.consume(client);
      const cached = cache.get(key);
      if (cached && now() - cached.createdAt < cacheTtlMs)
        return { ...cached.value, cached: true, shared: false };
      cache.delete(key);

      let job = jobs.get(key);
      const shared = Boolean(job && !job.controller.signal.aborted);
      if (!shared) {
        if (jobs.size >= maxConcurrent)
          throw busyError(
            'The service is busy. Please try again shortly.',
            'SCAN_CAPACITY',
            5,
          );
        job = {
          controller: new AbortController(),
          subscribers: new Set(),
          settled: false,
        };
        jobs.set(key, job);
        job.promise = Promise.resolve()
          .then(() =>
            withRequestBudget(
              () => run(args),
              budgetMs,
              timeoutMessage,
              job.controller.signal,
            ),
          )
          .then((value) => {
            if (!job.controller.signal.aborted) {
              cache.set(key, { value, createdAt: now() });
              trimCache(cache, maxCacheEntries);
            }
            return value;
          })
          .finally(() => {
            job.settled = true;
            if (jobs.get(key) === job) jobs.delete(key);
          });
      }
      if (job.subscribers.size >= maxSubscribers)
        throw busyError(
          'This scan has too many waiting requests. Please try again shortly.',
          'SCAN_CAPACITY',
          5,
        );
      const value = await subscribe(job, signal);
      return { ...value, cached: false, shared };
    },
  };
}
