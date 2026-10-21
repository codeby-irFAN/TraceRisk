import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const requestContext = new AsyncLocalStorage();

export function sleep(ms) {
  return delay(ms, undefined, { signal: requestContext.getStore() });
}

export async function withRequestBudget(
  task,
  timeoutMs,
  message,
  parentSignal,
) {
  const controller = new AbortController();
  const timeoutError = new Error(message);
  timeoutError.name = 'TimeoutError';
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal;
  let onAbort;

  try {
    signal.throwIfAborted();
    return await Promise.race([
      requestContext.run(signal, task),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 10_000) {
  const { retryRateLimit = true, ...fetchOptions } = options;
  const requestSignal = requestContext.getStore();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    requestSignal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals = [timeoutSignal, requestSignal, fetchOptions.signal].filter(
      Boolean,
    );
    const signal = AbortSignal.any(signals);

    try {
      const response = await fetch(url, { ...fetchOptions, signal });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (response.ok) throw new Error('API returned invalid JSON.');
        data = { message: text.slice(0, 400) };
      }

      if (response.ok) return data;

      const apiMessage =
        data?.reason ||
        data?.error?.message ||
        data?.message ||
        (typeof data?.error === 'string' ? data.error : null) ||
        `Request failed (${response.status})`;
      const message =
        typeof apiMessage === 'string'
          ? apiMessage
          : JSON.stringify(apiMessage);
      const error = new Error(
        response.status === 401 || response.status === 403
          ? `${message}. Check the API key and account access.`
          : `${message} (HTTP ${response.status})`,
      );
      error.status = response.status;

      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const date = Date.parse(retryAfter);
        error.retryAfterMs = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1_000)
          : Number.isFinite(date)
            ? Math.max(0, date - Date.now())
            : 0;
      }

      if (response.status === 429 && retryRateLimit && attempt === 0) {
        await sleep(Math.min(10_000, Math.max(1_500, error.retryAfterMs || 0)));
        continue;
      }
      throw error;
    } catch (error) {
      if (requestSignal?.aborted) throw requestSignal.reason;
      if (timeoutSignal.aborted) {
        const timeoutError = new Error(
          `Request timed out after ${Math.round(timeoutMs / 1_000)} seconds`,
        );
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    }
  }
}
