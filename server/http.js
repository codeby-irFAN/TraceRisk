import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const context = new AsyncLocalStorage();
export const currentSignal = () => context.getStore();
export const sleep = (ms) => delay(ms, undefined, { signal: currentSignal() });

// Nested work inherits cancellation, including time spent waiting in a queue.
export async function withRequestBudget(
  task,
  timeoutMs,
  message,
  parentSignal,
) {
  const controller = new AbortController();
  const error = Object.assign(new Error(message), { name: 'TimeoutError' });
  const signal = AbortSignal.any(
    [controller.signal, currentSignal(), parentSignal].filter(Boolean),
  );
  const timer = setTimeout(
    () => controller.abort(error),
    Math.max(1, timeoutMs),
  );
  let onAbort;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      context.run(signal, task),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds the size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error('Provider response exceeds the size limit.');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (response.ok) throw new Error('API returned invalid JSON.');
    return { message: `Provider returned HTTP ${response.status}.` };
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 5_000) {
  const {
    retryRateLimit = false,
    maxResponseBytes = 2_000_000,
    ...fetchOptions
  } = options;
  return withRequestBudget(
    async () => {
      for (let attempt = 0; attempt < (retryRateLimit ? 2 : 1); attempt++) {
        currentSignal().throwIfAborted();
        const response = await fetch(url, {
          ...fetchOptions,
          signal: currentSignal(),
        });
        const data = await readBoundedJson(response, maxResponseBytes);
        if (response.ok) return data;
        const message = String(
          data?.reason ||
            data?.error?.message ||
            data?.message ||
            'Provider request failed',
        ).slice(0, 240);
        const error = Object.assign(
          new Error(`${message} (HTTP ${response.status})`),
          { status: response.status },
        );
        const retry = response.headers.get('retry-after');
        if (retry) {
          const seconds = Number(retry);
          const date = Date.parse(retry);
          error.retryAfterMs = Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Number.isFinite(date)
              ? Math.max(0, date - Date.now())
              : 0;
        }
        if (response.status === 429 && retryRateLimit && attempt === 0) {
          await sleep(
            Math.min(2_000, Math.max(100, error.retryAfterMs || 1000)),
          );
        } else throw error;
      }
    },
    timeoutMs,
    `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
    fetchOptions.signal,
  );
}

export function createConcurrencyGate(limit, maxQueue = 64) {
  let active = 0;
  const queue = [];
  function release() {
    active--;
    while (queue.length) {
      const item = queue.shift();
      item.signal?.removeEventListener('abort', item.onAbort);
      if (item.signal?.aborted) {
        item.reject(item.signal.reason);
        continue;
      }
      active++;
      item.resolve();
      break;
    }
  }
  return async (task) => {
    const signal = currentSignal();
    signal?.throwIfAborted();
    if (active < limit) active++;
    else {
      if (queue.length >= maxQueue) throw new Error('Provider queue is full.');
      await new Promise((resolve, reject) => {
        const item = { resolve, reject, signal };
        item.onAbort = () => {
          const index = queue.indexOf(item);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason);
        };
        queue.push(item);
        signal?.addEventListener('abort', item.onAbort, { once: true });
        if (signal?.aborted) item.onAbort();
      });
    }
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      release();
    }
  };
}
