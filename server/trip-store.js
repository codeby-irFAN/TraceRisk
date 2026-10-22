import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const digest = (value) =>
  createHash('sha256').update(String(value)).digest('hex');
const decode = (row, now = Date.now) =>
  row
    ? {
        ...JSON.parse(row.payload),
        revision: row.revision,
        nextCheckAt: row.next_check
          ? new Date(row.next_check).toISOString()
          : null,
        watchEnded: row.watch_until < now(),
        checking: row.lock_until > now(),
      }
    : null;
export const tripError = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function createTripStore({
  filename = ':memory:',
  now = Date.now,
} = {}) {
  if (filename !== ':memory:')
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL, next_check INTEGER NOT NULL DEFAULT 0, watch_until INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS trips_workspace ON trips(workspace);
    CREATE INDEX IF NOT EXISTS trips_due ON trips(next_check, watch_until);
    CREATE TABLE IF NOT EXISTS shares (key_hash TEXT PRIMARY KEY, trip TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, workspace TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  const get = (workspace, id) =>
    decode(
      db
        .prepare('SELECT * FROM trips WHERE id=? AND workspace=?')
        .get(id, workspace),
      now,
    );
  return {
    persistent: filename !== ':memory:',
    close: () => db.close(),
    createWorkspace() {
      if (
        db.prepare('SELECT count(*) AS count FROM workspaces').get().count >=
        5000
      )
        throw tripError('Workspace capacity reached.', 503);
      const id = randomUUID(),
        key = `trw_${randomBytes(32).toString('base64url')}`;
      const workspace = {
        id,
        agencyName: 'My travel desk',
        contact: '',
        color: '#28594a',
        createdAt: new Date(now()).toISOString(),
      };
      db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(
        id,
        digest(key),
        JSON.stringify(workspace),
      );
      return { workspace, key };
    },
    authenticate(key) {
      if (!/^trw_[\w-]{43}$/.test(String(key))) return null;
      const row = db
        .prepare('SELECT payload FROM workspaces WHERE key_hash=?')
        .get(digest(key));
      return row ? JSON.parse(row.payload) : null;
    },
    updateWorkspace(workspace, patch) {
      const next = { ...workspace, ...patch, id: workspace.id };
      db.prepare('UPDATE workspaces SET payload=? WHERE id=?').run(
        JSON.stringify(next),
        workspace.id,
      );
      return next;
    },
    list(workspace) {
      return db
        .prepare('SELECT * FROM trips WHERE workspace=? ORDER BY rowid DESC')
        .all(workspace)
        .map((row) => decode(row, now));
    },
    get,
    create(workspace, value) {
      if (
        db
          .prepare('SELECT count(*) AS count FROM trips WHERE workspace=?')
          .get(workspace).count >= 50
      )
        throw tripError('This workspace can hold up to 50 trips.', 409);
      const trip = {
        ...value,
        id: randomUUID(),
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
        timeline: [],
        latest: null,
        comparison: null,
        lastError: null,
      };
      db.prepare(
        'INSERT INTO trips(id,workspace,payload,next_check,watch_until) VALUES(?,?,?,?,?)',
      ).run(
        trip.id,
        workspace,
        JSON.stringify(trip),
        trip.watch.enabled ? now() : 0,
        Date.parse(`${trip.stops.at(-1).endDate}T23:59:59Z`),
      );
      return get(workspace, trip.id);
    },
    update(workspace, id, revision, patch) {
      const existing = get(workspace, id);
      if (!existing) throw tripError('Trip not found.', 404);
      if (existing.revision !== revision)
        throw tripError('The trip changed. Refresh and try again.', 409);
      const next = {
        ...existing,
        ...patch,
        id,
        updatedAt: new Date(now()).toISOString(),
      };
      delete next.checking;
      delete next.revision;
      const due = next.watch.enabled
        ? patch.nextCheckAt
          ? Date.parse(patch.nextCheckAt)
          : now() + next.watch.frequencyHours * 3600000
        : 0;
      db.prepare(
        'UPDATE trips SET payload=?,revision=revision+1,next_check=?,watch_until=? WHERE id=? AND workspace=? AND revision=?',
      ).run(
        JSON.stringify(next),
        due,
        Date.parse(`${next.stops.at(-1).endDate}T23:59:59Z`),
        id,
        workspace,
        revision,
      );
      return get(workspace, id);
    },
    remove(workspace, id) {
      return (
        db
          .prepare('DELETE FROM trips WHERE workspace=? AND id=?')
          .run(workspace, id).changes > 0
      );
    },
    claim(workspace, id) {
      return (
        db
          .prepare(
            'UPDATE trips SET lock_until=? WHERE id=? AND workspace=? AND lock_until<=?',
          )
          .run(now() + 180000, id, workspace, now()).changes > 0
      );
    },
    release(workspace, id) {
      db.prepare(
        'UPDATE trips SET lock_until=0 WHERE workspace=? AND id=?',
      ).run(workspace, id);
    },
    due() {
      return db
        .prepare(
          'SELECT workspace,id FROM trips WHERE next_check>0 AND next_check<=? AND watch_until>=? AND lock_until<=? ORDER BY next_check LIMIT 10',
        )
        .all(now(), now(), now());
    },
    share(workspace, trip, snapshot) {
      db.prepare('DELETE FROM shares WHERE expires<=?').run(now());
      const key = randomBytes(32).toString('base64url'),
        expires = now() + 7 * 86400000;
      db.prepare('DELETE FROM shares WHERE trip=? AND workspace=?').run(
        trip,
        workspace,
      );
      db.prepare('INSERT INTO shares VALUES(?,?,?,?,?)').run(
        digest(key),
        trip,
        workspace,
        JSON.stringify(snapshot),
        expires,
      );
      return { key, expiresAt: new Date(expires).toISOString() };
    },
    readShare(key) {
      if (!/^[\w-]{43}$/.test(String(key))) return null;
      const row = db
        .prepare(
          'SELECT payload,expires FROM shares WHERE key_hash=? AND expires>?',
        )
        .get(digest(key), now());
      return row
        ? {
            ...JSON.parse(row.payload),
            expiresAt: new Date(row.expires).toISOString(),
          }
        : null;
    },
    revoke(workspace, trip) {
      db.prepare('DELETE FROM shares WHERE workspace=? AND trip=?').run(
        workspace,
        trip,
      );
    },
  };
}
