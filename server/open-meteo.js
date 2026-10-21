import {
  OPEN_METEO_PROXY_URL,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_CACHE_TTL_MS,
  OPEN_METEO_MIN_GAP_MS,
} from './config.js';
import { fetchJson, sleep } from './http.js';
import { trimCache } from './utils.js';

const openMeteoResponseCache = new Map();
let openMeteoQueue = Promise.resolve();
function getOpenMeteoRequestUrl(url) {
  if (!OPEN_METEO_PROXY_URL) return String(url);

  const original = new URL(String(url));
  const routeByEndpoint = {
    'geocoding-api.open-meteo.com/v1/search': '/geocoding/search',
    'api.open-meteo.com/v1/forecast': '/forecast',
    'flood-api.open-meteo.com/v1/flood': '/flood',
  };
  const route = routeByEndpoint[`${original.hostname}${original.pathname}`];
  if (!route) throw new Error('Unsupported Open-Meteo endpoint');

  const proxied = new URL(route, `${OPEN_METEO_PROXY_URL}/`);
  original.searchParams.forEach((value, key) => {
    proxied.searchParams.set(key, value);
  });
  return proxied.toString();
}

export async function openMeteoJson(
  url,
  options = {},
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
) {
  const cacheKey = String(url);

  function readCache() {
    const cached = openMeteoResponseCache.get(cacheKey);

    if (!cached) return undefined;

    if (Date.now() - cached.createdAt >= OPEN_METEO_CACHE_TTL_MS) {
      openMeteoResponseCache.delete(cacheKey);
      return undefined;
    }

    return cached.data;
  }

  const cached = readCache();
  if (cached !== undefined) return cached;

  const run = async () => {
    const queuedCached = readCache();
    if (queuedCached !== undefined) return queuedCached;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const requestUrl = getOpenMeteoRequestUrl(url);
        const requestOptions = { ...options, retryRateLimit: false };

        if (OPEN_METEO_PROXY_URL) {
          const token = process.env.OPEN_METEO_PROXY_TOKEN;
          if (!token) {
            throw new Error(
              'OPEN_METEO_PROXY_TOKEN is required when OPEN_METEO_PROXY_URL is configured',
            );
          }
          requestOptions.headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
          };
        }

        const data = await fetchJson(requestUrl, requestOptions, timeoutMs);

        openMeteoResponseCache.set(cacheKey, {
          createdAt: Date.now(),
          data,
        });

        trimCache(openMeteoResponseCache, 100);

        return data;
      } catch (error) {
        if (Number(error?.status) !== 429 || attempt === 2) {
          console.error('[TraceRisk] Open-Meteo request failed:', {
            url: cacheKey,
            status: error?.status,
            message: error?.message,
          });

          throw error;
        }

        const backoff = 1_500 * 2 ** attempt;
        const retryAfter = Number(error?.retryAfterMs) || 0;
        const waitMs = Math.max(backoff, retryAfter);

        console.warn(
          `[TraceRisk] Open-Meteo HTTP 429; retrying in ${waitMs}ms`,
        );

        await sleep(waitMs);
      }
    }

    throw new Error('Open-Meteo retry attempts exhausted');
  };

  const request = openMeteoQueue.then(run, run);

  openMeteoQueue = request.then(
    () => new Promise((resolve) => setTimeout(resolve, OPEN_METEO_MIN_GAP_MS)),
    () => new Promise((resolve) => setTimeout(resolve, OPEN_METEO_MIN_GAP_MS)),
  );

  return request;
}
