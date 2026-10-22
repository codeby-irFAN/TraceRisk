// Run locally against a backed-up SQLite file. No user passwords or sessions are copied.
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/supabase-store.js';
const args = process.argv.slice(2),
  value = (key) => args[args.indexOf(key) + 1];
if (!args.includes('--database') || !args.includes('--mapping'))
  throw new Error(
    'Usage: node scripts/migrate-supabase.mjs --database backup.sqlite --mapping private-user-map.json [--apply]',
  );
const mapping = JSON.parse(await readFile(value('--mapping'), 'utf8'));
if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object')
  throw new Error(
    'Mapping must be an object from local workspace ID to Supabase user ID.',
  );
const db = new DatabaseSync(value('--database'), { readOnly: true });
const apply = args.includes('--apply');
let store, admin;
if (apply) {
  if (
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error(
      'Set Supabase URL, publishable key and server secret locally.',
    );
  store = createSupabaseStore({
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  });
  admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
try {
  for (const [workspace, user] of Object.entries(mapping)) {
    if (!/^[a-f0-9-]{36}$/i.test(workspace) || !/^[a-f0-9-]{36}$/i.test(user))
      throw new Error('Mapping IDs must be UUIDs.');
    const rows = db
      .prepare('SELECT id,payload FROM trips WHERE workspace=?')
      .all(workspace);
    console.log(
      `${apply ? 'Import' : 'Dry run'}: ${rows.length} trip(s) for mapped user ${user}`,
    );
    if (!apply) continue;
    const { data, error } = await admin.auth.admin.getUserById(user);
    if (error || !data.user?.email_confirmed_at)
      throw new Error(
        'Each mapped Supabase account must exist and have a confirmed email.',
      );
    await store.workspace(user);
    const existing = await store.list(user);
    const fresh = rows.filter((r) => !existing.some((t) => t.id === r.id));
    if (existing.length + fresh.length > 50)
      throw new Error(
        'Import would exceed 50 trips. Nothing further imported for this account.',
      );
    for (const row of fresh)
      await store.create(user, JSON.parse(row.payload), row.id);
  }
} finally {
  db.close();
}
console.log(
  apply
    ? 'Import completed. Existing same-ID trips were skipped; public shares/passwords/sessions were not imported.'
    : 'No data changed. Review the mapping, then add --apply to import.',
);
