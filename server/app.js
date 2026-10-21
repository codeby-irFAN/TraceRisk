import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  REQUEST_BUDGET_MS,
  CACHE_TTL_MS,
  MAX_WEB_SOURCES,
  OPEN_METEO_PROXY_URL,
} from './config.js';
import { analyzeTrip } from './analyze.js';
import { withRequestBudget } from './http.js';
import { cleanText, isDate, trimCache } from './utils.js';

export const app = express();
const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const analysisCache = new Map();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'TraceRisk API',
    tinyfishConfigured: Boolean(process.env.TINYFISH_API_KEY),
    llmConfigured: Boolean(
      process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY,
    ),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    primaryProvider: process.env.GEMINI_API_KEY
      ? 'Google Gemini'
      : process.env.GROQ_API_KEY
        ? 'Groq (Gemini not configured)'
        : 'Rules-based only',
    fallbackProvider:
      process.env.GEMINI_API_KEY && process.env.GROQ_API_KEY ? 'Groq' : null,
    providerOrder:
      process.env.GEMINI_API_KEY && process.env.GROQ_API_KEY
        ? ['Gemini', 'Groq']
        : process.env.GEMINI_API_KEY
          ? ['Gemini']
          : process.env.GROQ_API_KEY
            ? ['Groq']
            : ['Rules'],
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    fallbackModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    searchLanes: 8,
    maxWebSources: MAX_WEB_SOURCES,
    scanBudgetMs: REQUEST_BUDGET_MS,
    weatherProvider:
      'Open-Meteo (automatic geocoding; no key; non-commercial use)',
    weatherProxyMode: OPEN_METEO_PROXY_URL
      ? 'Cloudflare Worker'
      : 'Direct Open-Meteo',
    weatherProxyConfigured: Boolean(
      OPEN_METEO_PROXY_URL && process.env.OPEN_METEO_PROXY_TOKEN,
    ),
  });
});

app.post('/api/analyze', async (req, res) => {
  const startedAt = Date.now();
  const destination =
    typeof req.body?.destination === 'string'
      ? cleanText(req.body.destination, 90)
      : '';
  const startDate = req.body?.startDate;
  const endDate = req.body?.endDate;

  if (!destination || destination.length < 2) {
    return res
      .status(400)
      .json({ error: 'Enter an Indian city or destination.' });
  }
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
    return res.status(400).json({
      error:
        'Choose valid travel dates. The end date must not be before the start date.',
    });
  }
  if (!process.env.TINYFISH_API_KEY) {
    return res.status(503).json({
      error:
        'TinyFish is not configured. Add TINYFISH_API_KEY to your .env file and restart the server.',
      code: 'MISSING_TINYFISH_KEY',
    });
  }

  const cacheKey = `${destination.toLocaleLowerCase('en-IN')}|${startDate}|${endDate}`;
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return res.json({
      ...cached.payload,
      cached: true,
      durationMs: Date.now() - startedAt,
    });
  }

  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on('close', onClose);

  try {
    const result = await withRequestBudget(
      () => analyzeTrip({ destination, startDate, endDate }),
      REQUEST_BUDGET_MS,
      'The scan exceeded the 100-second limit. Retry shortly; a timeout does not mean the destination is safe.',
      controller.signal,
    );
    result.durationMs = Date.now() - startedAt;
    result.checkedAt = new Date().toISOString();
    analysisCache.set(cacheKey, { createdAt: Date.now(), payload: result });
    trimCache(analysisCache, 20);
    return res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error('[TraceRisk] analysis error:', error?.message || error);
    const timedOut =
      error?.name === 'TimeoutError' ||
      /timed out|time limit/i.test(error?.message || '');
    return res.status(timedOut ? 504 : 502).json({
      error: error?.message || 'The scan failed. Please try again.',
      code: timedOut ? 'SCAN_TIMEOUT' : 'SCAN_FAILED',
    });
  } finally {
    res.off('close', onClose);
  }
});

app.use('/api', (_req, res) =>
  res.status(404).json({ error: 'API endpoint not found.' }),
);

if (existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  console.error('[TraceRisk] request error:', error.message);
  return res
    .status(500)
    .json({ error: 'An unexpected server error occurred.' });
});
