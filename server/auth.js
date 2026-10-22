import express from 'express';
import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { createRateLimiter } from './scan-manager.js';
import { tripError } from './trip-store.js';
const scrypt = promisify(derive);
const PASSWORD_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt:32768:8:3:${'0'.repeat(32)}:${'0'.repeat(128)}`;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const COOKIE = 'tracerisk_session';
const SESSION_MS = 14 * 86400000;
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, PASSWORD_OPTIONS);
  return `scrypt:32768:8:3:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  const parts = encoded.split(':');
  const legacy = parts.length === 2;
  const salt = legacy ? parts[0] : parts[4],
    hex = legacy ? parts[1] : parts[5];
  if (!salt || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  if (
    !legacy &&
    (parts[0] !== 'scrypt' ||
      parts[1] !== '32768' ||
      parts[2] !== '8' ||
      parts[3] !== '3')
  )
    return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(
    password,
    salt,
    64,
    legacy
      ? { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
      : PASSWORD_OPTIONS,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createAccountStore(db, now = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, workspace TEXT UNIQUE NOT NULL REFERENCES workspaces(id), created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  const profile = (row) =>
    row
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          workspaceId: row.workspace,
        }
      : null;
  return {
    find: (email) => db.prepare('SELECT * FROM users WHERE email=?').get(email),
    workspaceOwned: (workspace) =>
      Boolean(
        db.prepare('SELECT id FROM users WHERE workspace=?').get(workspace),
      ),
    create({ id, email, name, passwordHash, workspace }) {
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(
        id,
        email,
        name,
        passwordHash,
        workspace,
        now(),
      );
      return profile(this.find(email));
    },
    profile,
    session(userId) {
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
      // Bound stored sessions per account without invalidating the most recent devices.
      db.prepare(
        'DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT 9)',
      ).run(userId, userId);
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
        digest(token),
        userId,
        now() + SESSION_MS,
      );
      return token;
    },
    authenticate(token) {
      if (!/^[\w-]{43}$/.test(token || '')) return null;
      return profile(
        db
          .prepare(
            'SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?',
          )
          .get(digest(token), now()),
      );
    },
    logout(token) {
      if (token)
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(
          digest(token),
        );
    },
    changePassword(userId, hash) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(
          hash,
          userId,
        );
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
export function cookieToken(req) {
  return (
    req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) || ''
  );
}
export function requireSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.get('X-TraceRisk-Request') !== '1')
    throw tripError('Please refresh the page and try again.', 403);
  const origin = req.get('origin');
  if (!origin) return;
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin === expected) return;
  if (process.env.NODE_ENV !== 'production') {
    try {
      if (
        ['localhost', '127.0.0.1'].includes(new URL(origin).hostname) &&
        ['localhost', '127.0.0.1'].includes(req.hostname)
      )
        return;
    } catch {
      /* Reject malformed origins. */
    }
  }
  throw tripError('Please use the TraceRisk website to make this change.', 403);
}
export function accountFor(req, store) {
  return store.accounts.authenticate(cookieToken(req));
}
function setSession(res, req, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MS,
  });
}
const credentials = (body) => {
  const email = String(body?.email || '')
    .trim()
    .toLowerCase();
  const password = body?.password;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof password !== 'string' ||
    password.length > 128 ||
    !password.length
  )
    throw tripError('Enter a valid email address and password.');
  return { email, password };
};
export function createAuthRouter(store) {
  const router = express.Router(),
    limit = createRateLimiter({ limit: 12, windowMs: 600000 });
  let hashing = 0;
  const hashWork = async (task) => {
    if (hashing >= 3)
      throw tripError('Sign-in is busy. Please try again shortly.', 429);
    hashing++;
    try {
      return await task();
    } finally {
      hashing--;
    }
  };
  router.use((req, _res, next) => {
    try {
      requireSameOrigin(req);
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get('/session', (req, res) =>
    res.json({ user: accountFor(req, store) }),
  );
  router.post('/register', async (req, res) => {
    limit.consume(req.ip);
    const { email, password } = credentials(req.body);
    if (password.length < 10)
      throw tripError('Use a password with at least 10 characters.');
    const name = String(req.body?.name || '')
      .trim()
      .slice(0, 80);
    if (!name) throw tripError('Enter your name.');
    const hash = await hashWork(() => passwordHash(password));
    if (store.accounts.find(email))
      throw tripError(
        'An account already uses this email. Sign in instead.',
        409,
      );
    let workspace = store.authenticate(req.body?.legacyKey);
    if (workspace && store.accounts.workspaceOwned(workspace.id))
      workspace = null;
    workspace ||= store.createWorkspace().workspace;
    const user = store.accounts.create({
      id: randomBytes(16).toString('hex'),
      email,
      name,
      passwordHash: hash,
      workspace: workspace.id,
    });
    setSession(res, req, store.accounts.session(user.id));
    res.status(201).json({ user });
  });
  router.post('/login', async (req, res) => {
    limit.consume(req.ip);
    const { email, password } = credentials(req.body);
    const row = store.accounts.find(email);
    // Perform the same expensive operation for unknown addresses.
    const matched = await hashWork(() =>
      passwordMatches(password, row?.password_hash || DUMMY_HASH),
    );
    if (!row || !matched)
      throw tripError('Email or password is incorrect.', 401);
    store.importLegacy(req.body?.legacyKey, row.workspace);
    setSession(res, req, store.accounts.session(row.id));
    res.json({ user: store.accounts.profile(row) });
  });
  router.post('/logout', (req, res) => {
    store.accounts.logout(cookieToken(req));
    res.clearCookie(COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || process.env.NODE_ENV === 'production',
      path: '/',
    });
    res.status(204).end();
  });
  router.post('/password', async (req, res) => {
    limit.consume(req.ip);
    const user = accountFor(req, store);
    if (!user) throw tripError('Please sign in again.', 401);
    const current = req.body?.currentPassword,
      password = req.body?.newPassword;
    if (
      typeof current !== 'string' ||
      current.length > 128 ||
      typeof password !== 'string' ||
      password.length < 10 ||
      password.length > 128
    )
      throw tripError(
        'Enter your current password and a new password of 10–128 characters.',
      );
    const row = store.accounts.find(user.email);
    if (!(await hashWork(() => passwordMatches(current, row.password_hash))))
      throw tripError('Current password is incorrect.', 400);
    store.accounts.changePassword(
      user.id,
      await hashWork(() => passwordHash(password)),
    );
    setSession(res, req, store.accounts.session(user.id));
    res.json({ ok: true });
  });
  router.use((error, _req, res, _next) => {
    if (error.retryAfterSeconds)
      res.set('Retry-After', String(error.retryAfterSeconds));
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Sign-in could not be completed. Please try again.',
    });
  });
  return router;
}
