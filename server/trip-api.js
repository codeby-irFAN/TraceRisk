import express from 'express';
import { createRateLimiter } from './scan-manager.js';
import { cleanText } from './utils.js';
import { validateTrip } from './trip-service.js';
import { answerTripQuestion } from './trip-intelligence.js';
import { tripError } from './trip-store.js';

const brief = (trip) => ({
  ...trip,
  latest: trip.latest
    ? {
        checkedAt: trip.latest.checkedAt,
        issueCount: trip.latest.issueCount,
        highSignals: trip.latest.highSignals,
        coverage: trip.latest.coverage,
        reportsChecked: trip.latest.reportsChecked,
        reportsTotal: trip.latest.reportsTotal,
      }
    : null,
  comparison: Boolean(trip.comparison),
  timeline: undefined,
  unreadCount: (trip.timeline || []).filter((e) => !e.read).length,
});
export function createTripRouter({ store, service, locationResolver }) {
  const router = express.Router();
  const createLimit = createRateLimiter({ limit: 8, windowMs: 3600000 });
  const readLimit = createRateLimiter({ limit: 180, windowMs: 60000 });
  const checkLimit = createRateLimiter({ limit: 8, windowMs: 600000 });
  router.post('/workspaces', (req, res) => {
    createLimit.consume(req.ip);
    res.status(201).json(store.createWorkspace());
  });
  router.get('/shared/:key', (req, res) => {
    readLimit.consume(req.ip);
    const snapshot = store.readShare(req.params.key);
    if (!snapshot)
      throw tripError('This briefing link has expired or was revoked.', 404);
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.json(snapshot);
  });
  router.use(['/workspace', '/trips'], (req, res, next) => {
    readLimit.consume(req.ip);
    const match = req.get('authorization')?.match(/^Bearer (trw_[\w-]{43})$/);
    const workspace = match && store.authenticate(match[1]);
    if (!workspace)
      return res.status(401).json({
        error: 'Open or restore your private workspace first.',
        code: 'WORKSPACE_REQUIRED',
      });
    req.workspace = workspace;
    next();
  });
  router.get('/workspace', (req, res) =>
    res.json({
      workspace: req.workspace,
      ...service.status(),
      persistent: store.persistent,
    }),
  );
  router.patch('/workspace', (req, res) => {
    const color = /^#[a-f0-9]{6}$/i.test(req.body?.color || '')
      ? req.body.color
      : req.workspace.color;
    res.json({
      workspace: store.updateWorkspace(req.workspace, {
        agencyName: cleanText(req.body?.agencyName || 'My travel desk', 80),
        contact: cleanText(req.body?.contact, 160),
        color,
      }),
    });
  });
  router.get('/trips', (req, res) =>
    res.json({
      trips: store.list(req.workspace.id).map(brief),
      ...service.status(),
    }),
  );
  router.post('/trips', (req, res) =>
    res.status(201).json({
      trip: store.create(
        req.workspace.id,
        validateTrip(req.body, locationResolver),
      ),
    }),
  );
  router.param('id', (req, _res, next, id) => {
    req.trip = store.get(req.workspace.id, id);
    if (!req.trip) return next(tripError('Trip not found.', 404));
    next();
  });
  router.get('/trips/:id', (req, res) => res.json({ trip: req.trip }));
  router.put('/trips/:id', (req, res) => {
    if (req.trip.checking)
      throw tripError(
        'Cancel the running check before editing this trip.',
        409,
      );
    const config = validateTrip(req.body, locationResolver, req.trip);
    store.revoke(req.workspace.id, req.trip.id);
    res.json({
      trip: store.update(req.workspace.id, req.trip.id, req.trip.revision, {
        ...config,
        latest: null,
        comparison: null,
        timeline: [],
        lastError: null,
      }),
    });
  });
  router.patch('/trips/:id/watch', (req, res) => {
    if (req.trip.checking)
      throw tripError(
        'Wait for the current check before changing watch settings.',
        409,
      );
    const hours = Number(
      req.body?.frequencyHours || req.trip.watch.frequencyHours,
    );
    if (![1, 3, 6, 12, 24].includes(hours))
      throw tripError('Choose a supported check frequency.');
    const watch = {
      enabled: req.body?.enabled === true,
      frequencyHours: hours,
      alertLevel: req.body?.alertLevel === 'high' ? 'high' : 'all',
    };
    res.json({
      trip: store.update(req.workspace.id, req.trip.id, req.trip.revision, {
        watch,
      }),
    });
  });
  router.delete('/trips/:id', (req, res) => {
    service.cancel(req.workspace.id, req.trip.id);
    store.remove(req.workspace.id, req.trip.id);
    res.status(204).end();
  });
  router.post('/trips/:id/check', (req, res) => {
    checkLimit.consume(req.workspace.id);
    res.status(202).json(service.check(req.workspace.id, req.trip.id));
  });
  router.post('/trips/:id/compare', (req, res) => {
    checkLimit.consume(req.workspace.id);
    res
      .status(202)
      .json(service.compare(req.workspace.id, req.trip.id, req.body));
  });
  router.post('/trips/:id/cancel', (req, res) =>
    res.json({ cancelled: service.cancel(req.workspace.id, req.trip.id) }),
  );
  router.post('/trips/:id/read', (req, res) => {
    if (req.trip.checking)
      throw tripError(
        'Wait for the current check to finish before marking updates read.',
        409,
      );
    res.json({
      trip: store.update(req.workspace.id, req.trip.id, req.trip.revision, {
        timeline: req.trip.timeline.map((event) => ({ ...event, read: true })),
        ...(req.trip.nextCheckAt ? { nextCheckAt: req.trip.nextCheckAt } : {}),
      }),
    });
  });
  router.post('/trips/:id/ask', (req, res) => {
    const question = cleanText(req.body?.question, 500);
    if (question.length < 4) throw tripError('Ask a question about this trip.');
    res.json(answerTripQuestion(req.trip, question));
  });
  router.post('/trips/:id/share', (req, res) => {
    if (!req.trip.latest)
      throw tripError('Complete a trip check before sharing a briefing.', 409);
    const { title, origin, stops, preferences, latest, client } = req.trip;
    const snapshot = {
      title,
      origin,
      stops,
      preferences,
      latest,
      client: req.body?.includeClient === true ? client : '',
      agency: {
        name: req.workspace.agencyName,
        contact: req.workspace.contact,
        color: req.workspace.color,
      },
      sharedAt: new Date().toISOString(),
    };
    const share = store.share(req.workspace.id, req.trip.id, snapshot);
    res
      .status(201)
      .json({ path: `/share/${share.key}`, expiresAt: share.expiresAt });
  });
  router.delete('/trips/:id/share', (req, res) => {
    store.revoke(req.workspace.id, req.trip.id);
    res.status(204).end();
  });
  router.use((error, _req, res, _next) => {
    if (error.retryAfterSeconds)
      res.set('Retry-After', String(error.retryAfterSeconds));
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'The trip operation could not be completed. Please try again.',
    });
  });
  return router;
}
