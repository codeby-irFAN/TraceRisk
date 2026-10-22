import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  REQUEST_BUDGET_MS,
  CACHE_TTL_MS,
  MAX_WEB_SOURCES,
  OPEN_METEO_PROXY_URL,
  MAX_CONCURRENT_SCANS,
  SCAN_RATE_LIMIT,
  SCAN_RATE_WINDOW_MS,
  TRUST_PROXY_HOPS,
  DEFAULT_GROQ_MODEL,
  ENGINE_VERSION,
  hasCredential,
} from './config.js';
import { analyzeTrip } from './analyze.js';
import { cleanText, isDate } from './utils.js';
import { createLocationResolver, normalizeDestination } from './locations.js';
import { createScanManager } from './scan-manager.js';

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
export function createApp({
  scan = analyzeTrip,
  locationResolver = createLocationResolver(),
  scanOptions = {},
  locationOptions = {},
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('X-Request-Id', randomUUID());
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  if (TRUST_PROXY_HOPS) app.set('trust proxy', TRUST_PROXY_HOPS);
  const scans = createScanManager({
    run: async (args) => ({
      ...(await scan(args)),
      checkedAt: new Date().toISOString(),
    }),
    maxConcurrent: MAX_CONCURRENT_SCANS,
    rateLimit: SCAN_RATE_LIMIT,
    rateWindowMs: SCAN_RATE_WINDOW_MS,
    cacheTtlMs: CACHE_TTL_MS,
    budgetMs: REQUEST_BUDGET_MS,
    timeoutMessage:
      'The scan exceeded the 20-second processing limit. Please try again.',
    ...scanOptions,
  });
  const lookups = createScanManager({
    run: async (destination) => ({
      locations: await locationResolver.resolve(destination),
    }),
    maxConcurrent: 4,
    rateLimit: 20,
    rateWindowMs: 60_000,
    cacheTtlMs: 9 * 60_000,
    maxCacheEntries: 100,
    budgetMs: 8_000,
    timeoutMessage:
      'Location lookup timed out. Try again with a city and state.',
    ...locationOptions,
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'TraceRisk API',
      engineVersion: ENGINE_VERSION,
      tinyfishConfigured: hasCredential('TINYFISH_API_KEY'),
      llmConfigured: hasCredential('GROQ_API_KEY'),
      groqConfigured: hasCredential('GROQ_API_KEY'),
      primaryProvider: hasCredential('GROQ_API_KEY')
        ? 'Groq'
        : 'Rules-based only',
      fallbackProvider: null,
      providerOrder: hasCredential('GROQ_API_KEY') ? ['Groq'] : ['Rules'],
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      fallbackModel: null,
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

  function clientSignal(res) {
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);
    return {
      signal: controller.signal,
      cleanup: () => res.off('close', onClose),
    };
  }

  function sendFailure(res, error) {
    if (error.retryAfterSeconds)
      res.set('Retry-After', String(error.retryAfterSeconds));
    const timedOut = error.name === 'TimeoutError';
    return res.status(error.status || (timedOut ? 504 : 502)).json({
      error: error.message || 'The request failed. Please try again.',
      code: error.code || (timedOut ? 'SCAN_TIMEOUT' : 'SCAN_FAILED'),
    });
  }

  app.get('/api/locations', async (req, res) => {
    const destination =
      typeof req.query.destination === 'string'
        ? cleanText(req.query.destination, 90)
        : '';
    if (destination.length < 2)
      return res
        .status(400)
        .json({ error: 'Enter an Indian city or destination.' });
    const client = clientSignal(res);
    try {
      const result = await lookups.request(
        normalizeDestination(destination),
        destination,
        { client: req.ip, signal: client.signal },
      );
      return res.json(result);
    } catch (error) {
      if (!client.signal.aborted) return sendFailure(res, error);
    } finally {
      client.cleanup();
    }
  });

  app.post('/api/analyze', async (req, res) => {
    const startedAt = Date.now();
    const destination =
      typeof req.body?.destination === 'string'
        ? cleanText(req.body.destination, 90)
        : '';
    const { startDate, endDate } = req.body || {};
    if (destination.length < 2)
      return res
        .status(400)
        .json({ error: 'Enter an Indian city or destination.' });
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate)
      return res.status(400).json({
        error:
          'Choose valid travel dates. The end date must not be before the start date.',
      });
    if ((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 > 89)
      return res.status(400).json({
        error: 'Choose a trip of at most 90 days.',
        code: 'TRIP_TOO_LONG',
      });
    const location = locationResolver.get(req.body.locationId, destination);
    if (!location)
      return res.status(400).json({
        error: 'Find and confirm your destination again before scanning.',
        code: 'LOCATION_REQUIRED',
      });
    const cacheKey = JSON.stringify([
      location.name,
      location.admin1,
      location.admin2,
      location.latitude,
      location.longitude,
      startDate,
      endDate,
    ]);
    const client = clientSignal(res);
    try {
      const result = await scans.request(
        cacheKey,
        {
          destination: location.label,
          startDate,
          endDate,
          location,
        },
        { client: req.ip, signal: client.signal },
      );
      res.set('Server-Timing', `scan;dur=${Date.now() - startedAt}`);
      return res.json({
        ...result,
        requestId: res.get('X-Request-Id'),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (!client.signal.aborted) return sendFailure(res, error);
    } finally {
      client.cleanup();
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
      return res
        .status(400)
        .json({ error: 'Request body must be valid JSON.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.' });
    }
    console.error('[TraceRisk] request error:', error.message);
    return res
      .status(500)
      .json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}

export const app = createApp();
