import 'dotenv/config';

export const PORT = Number(process.env.PORT || 8787);

export const TINYFISH_SEARCH = 'https://api.search.tinyfish.ai/';
export const TINYFISH_FETCH = 'https://api.fetch.tinyfish.ai/';

export const OPEN_METEO_GEOCODING =
  'https://geocoding-api.open-meteo.com/v1/search';
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_FLOOD = 'https://flood-api.open-meteo.com/v1/flood';
export const GEOCODING_TIMEOUT_MS = 3_500;
export const OPEN_METEO_TIMEOUT_MS = 6_000;
export const OPEN_METEO_CACHE_TTL_MS = 5 * 60 * 1_000;
export const OPEN_METEO_PROXY_URL = (
  process.env.OPEN_METEO_PROXY_URL || ''
).replace(/\/+$/, '');

export const SEARCH_TIMEOUT_MS = 2_700;
export const FETCH_TIMEOUT_MS = 4_500;
export const REQUEST_BUDGET_MS = 20_000;
export const SCAN_STAGES = Object.freeze({
  search: 6_000,
  extraction: 5_000,
  weather: 8_000,
  assessment: 6_500,
});
export const CACHE_TTL_MS = 60_000;
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
export const ENGINE_VERSION = '5.3.0';

export const MAX_WEB_SOURCES = 12;
export const FETCH_BATCH_SIZE = 1;

export function hasCredential(name) {
  const value = String(process.env[name] || '').trim();
  return (
    Boolean(value) &&
    !/^(your[_ -]|placeholder|replace[_ -]|changeme)/i.test(value)
  );
}

function positiveInteger(name, fallback, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value <= max
    ? value
    : fallback;
}

export const MAX_CONCURRENT_SCANS = positiveInteger(
  'MAX_CONCURRENT_SCANS',
  3,
  20,
);
export const SCAN_RATE_LIMIT = positiveInteger('SCAN_RATE_LIMIT', 6, 100);
export const SCAN_RATE_WINDOW_MS = positiveInteger(
  'SCAN_RATE_WINDOW_MS',
  600_000,
  86_400_000,
);
export const TRUST_PROXY_HOPS = positiveInteger('TRUST_PROXY_HOPS', 0, 10);
