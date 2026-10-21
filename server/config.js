import 'dotenv/config';

export const PORT = Number(process.env.PORT || 8787);

export const TINYFISH_SEARCH = 'https://api.search.tinyfish.ai/';
export const TINYFISH_FETCH = 'https://api.fetch.tinyfish.ai/';

export const OPEN_METEO_GEOCODING =
  'https://geocoding-api.open-meteo.com/v1/search';
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_FLOOD = 'https://flood-api.open-meteo.com/v1/flood';
export const GEOCODING_TIMEOUT_MS = 10_000;
export const OPEN_METEO_TIMEOUT_MS = 20_000;
export const OPEN_METEO_MIN_GAP_MS = 1_500;
export const OPEN_METEO_CACHE_TTL_MS = 10 * 60 * 1_000;
export const OPEN_METEO_PROXY_URL = (
  process.env.OPEN_METEO_PROXY_URL || ''
).replace(/\/+$/, '');

export const SEARCH_TIMEOUT_MS = 7_000;
export const FETCH_TIMEOUT_MS = 20_000;
export const LLM_TIMEOUT_MS = 12_000;
export const GEMINI_RETRY_DELAY_MS = 900;
export const GROQ_RETRY_DELAY_MS = 900;
export const REQUEST_BUDGET_MS = 100_000;
export const CACHE_TTL_MS = 45_000;

export const SEARCH_CONCURRENCY = 8;
export const MAX_WEB_SOURCES = 20;
export const FETCH_BATCH_SIZE = 10;
