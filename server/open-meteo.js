import {
  OPEN_METEO_PROXY_URL,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_CACHE_TTL_MS,
} from './config.js';
import {
  fetchJson,
  createConcurrencyGate,
  withRequestBudget,
  currentSignal,
} from './http.js';
import { trimCache } from './utils.js';

const cache = new Map();
const gates = new Map();
function transportUrl(value) {
  if (!OPEN_METEO_PROXY_URL) return String(value);
  const original = new URL(value);
  const routes = {
    'geocoding-api.open-meteo.com/v1/search': '/geocoding/search',
    'api.open-meteo.com/v1/forecast': '/forecast',
    'flood-api.open-meteo.com/v1/flood': '/flood',
  };
  const route = routes[`${original.hostname}${original.pathname}`];
  if (!route) throw new Error('Unsupported Open-Meteo endpoint');
  const url = new URL(route, `${OPEN_METEO_PROXY_URL}/`);
  url.search = original.search;
  return url.toString();
}

export async function openMeteoJson(
  url,
  options = {},
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
) {
  currentSignal()?.throwIfAborted();
  const key = String(url);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.createdAt < OPEN_METEO_CACHE_TTL_MS)
    return hit.data;
  cache.delete(key);
  const endpoint = transportUrl(url);
  const host = new URL(endpoint).host;
  if (!gates.has(host)) gates.set(host, createConcurrencyGate(4));
  return withRequestBudget(
    () =>
      gates.get(host)(async () => {
        const headers = { ...options.headers };
        if (OPEN_METEO_PROXY_URL) {
          if (!process.env.OPEN_METEO_PROXY_TOKEN)
            throw new Error('The weather proxy is not configured.');
          headers.Authorization = `Bearer ${process.env.OPEN_METEO_PROXY_TOKEN}`;
        }
        const data = await fetchJson(
          endpoint,
          { ...options, headers, retryRateLimit: false },
          timeoutMs,
        );
        currentSignal()?.throwIfAborted();
        data._traceRiskRetrievedAt = new Date().toISOString();
        cache.set(key, { data, createdAt: Date.now() });
        trimCache(cache, 200);
        return data;
      }),
    timeoutMs,
    'Weather provider exceeded its time budget.',
  );
}
