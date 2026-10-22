import { supabaseFetch } from './supabase-http.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { tripError } from './trip-store.js';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function createSupabaseStore({
  url,
  publishableKey,
  secretKey,
  clientFactory = createClient,
} = {}) {
  const context = new AsyncLocalStorage();
  const options = {
    global: { fetch: supabaseFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const publicClient = clientFactory(url, publishableKey, options);
  const admin = secretKey ? clientFactory(url, secretKey, options) : null;
  const client = () => context.getStore() || admin;
  async function call(action, args = {}) {
    const write = ![
      'get',
      'list',
      'workspace',
      'updateWorkspace',
      'due',
    ].includes(action);
    if (write && !admin)
      throw tripError(
        'Trip storage is not fully configured. Please contact the site administrator.',
        503,
      );
    const scoped = write ? admin : client();
    if (!scoped) throw tripError('Please sign in again.', 401);
    const { data, error } = await scoped.rpc('tracerisk_store', {
      action,
      args,
    });
    if (error && action === 'claimLong' && error.code === '22023')
      throw tripError(
        'Thorough checks need the latest database setup. Please contact the site administrator.',
        503,
      );
    if (error) {
      const status =
        error.code === '42501'
          ? 403
          : error.code === 'P0002'
            ? 404
            : error.code === '40001' || error.code === '23505'
              ? 409
              : ['22023', '22007', '22P02', '23514'].includes(error.code)
                ? 400
                : 503;
      throw tripError(
        status === 503
          ? 'Trip storage is not ready. Please try again or check the Supabase setup.'
          : error.message,
        status,
      );
    }
    return data;
  }
  return {
    provider: 'supabase',
    persistent: true,
    monitoringAvailable: Boolean(admin),
    close() {},
    runWithToken(token, task) {
      return context.run(
        clientFactory(url, publishableKey, {
          ...options,
          global: {
            fetch: supabaseFetch,
            headers: { Authorization: `Bearer ${token}` },
          },
        }),
        task,
      );
    },
    workspace(id) {
      return call('workspace', { workspace: id });
    },
    updateWorkspace(workspace, patch) {
      return call('updateWorkspace', { workspace: workspace.id, patch });
    },
    list(workspace) {
      return call('list', { workspace });
    },
    get(workspace, id) {
      return call('get', { workspace, id });
    },
    create(workspace, value, id) {
      const stamp = new Date().toISOString();
      return call('create', {
        workspace,
        id,
        value: {
          ...value,
          createdAt: value.createdAt || stamp,
          updatedAt: stamp,
          latest: value.latest || null,
          comparison: value.comparison || null,
          timeline: value.timeline || [],
          lastError: null,
        },
      });
    },
    update(workspace, id, revision, patch) {
      return call('update', { workspace, id, revision, patch });
    },
    remove(workspace, id) {
      return call('remove', { workspace, id });
    },
    claim(workspace, id, leaseMs = 180000) {
      return call(leaseMs > 180000 ? 'claimLong' : 'claim', {
        workspace,
        id,
        leaseMs,
      });
    },
    release(workspace, id) {
      return call('release', { workspace, id });
    },
    due() {
      return admin ? call('due') : [];
    },
    async share(workspace, id, snapshot) {
      const key = randomBytes(32).toString('base64url');
      return {
        ...(await call('share', {
          workspace,
          id,
          keyHash: digest(key),
          snapshot,
        })),
        key,
      };
    },
    async readShare(key) {
      if (!/^[\w-]{43}$/.test(String(key))) return null;
      const { data, error } = await publicClient.rpc('tracerisk_read_share', {
        key_hash: digest(key),
      });
      if (error)
        throw tripError(
          'This briefing could not be loaded. Try again shortly.',
          503,
        );
      return data;
    },
    revoke(workspace, id) {
      return call('revoke', { workspace, id });
    },
  };
}
