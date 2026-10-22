import { supabaseFetch } from './supabase-http.js';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { randomBytes, createHash } from 'node:crypto';
import express from 'express';
import { requireSameOrigin } from './auth.js';
import { createRateLimiter } from './scan-manager.js';
import { tripError } from './trip-store.js';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function supabaseAuth({
  url,
  publishableKey,
  siteUrl,
  clientFactory = createServerClient,
}) {
  const site = new URL(siteUrl);
  if (!['http:', 'https:'].includes(site.protocol))
    throw new Error('Invalid SITE_URL');
  const client = (req, res) => {
    if (req.supabaseAuth) return req.supabaseAuth;
    const jar = new Map(
      parseCookieHeader(req.headers.cookie || '').map(({ name, value }) => [
        name,
        value,
      ]),
    );
    req.supabaseAuth = clientFactory(url, publishableKey, {
      global: { fetch: supabaseFetch },
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || process.env.NODE_ENV === 'production',
        path: '/',
      },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const { name, value, options } of values) {
            jar.set(name, value);
            res.cookie(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: req.secure || process.env.NODE_ENV === 'production',
              path: '/',
            });
          }
        },
      },
    });
    return req.supabaseAuth;
  };
  const profile = (user) =>
    user
      ? {
          id: user.id,
          email: user.email,
          name:
            typeof user.user_metadata?.name === 'string'
              ? user.user_metadata.name.slice(0, 80)
              : user.email?.split('@')[0] || 'Traveller',
          workspaceId: user.id,
        }
      : null;
  async function account(req, res) {
    const sdk = client(req, res);
    const { data, error } = await sdk.auth.getUser();
    if (
      error &&
      (error.status >= 500 || error.name === 'AuthRetryableFetchError')
    )
      throw tripError(
        'Sign-in is temporarily unavailable. Please try again.',
        503,
      );
    if (error || !data.user) return null;
    const session = await sdk.auth.getSession();
    if (!session.data.session) return null;
    req.supabaseAccessToken = session.data.session.access_token;
    return profile(data.user);
  }
  const router = express.Router(),
    limit = createRateLimiter({ limit: 12, windowMs: 600000 });
  router.use((req, _res, next) => {
    try {
      requireSameOrigin(req);
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get('/session', async (req, res) =>
    res.json({ user: await account(req, res), provider: 'supabase' }),
  );
  const credentials = (body) => {
    const email = String(body?.email || '')
        .trim()
        .toLowerCase(),
      password = body?.password;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== 'string' ||
      !password.length ||
      password.length > 128
    )
      throw tripError('Enter a valid email address and password.');
    return { email, password };
  };
  router.post('/google', async (req, res) => {
    limit.consume(req.ip);
    let settings;
    try {
      const response = await supabaseFetch(new URL('/auth/v1/settings', url), {
        headers: { apikey: publishableKey },
      });
      if (response.ok) settings = await response.json();
    } catch {
      throw tripError(
        'Google sign-in is temporarily unavailable. Please use email and password.',
        503,
      );
    }
    if (!settings?.external?.google)
      throw tripError(
        'Google sign-in is not enabled yet. Please use email and password.',
        503,
      );
    const { data, error } = await client(req, res).auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/auth/callback', site).href,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url)
      throw tripError(
        'Google sign-in is not available yet. You can use email and password.',
        503,
      );
    const target = new URL(data.url);
    if (
      target.origin !== new URL(url).origin ||
      target.pathname !== '/auth/v1/authorize'
    )
      throw tripError('Google sign-in could not start. Please try again.', 503);
    res.json({ url: target.href });
  });
  router.post('/register', async (req, res) => {
    limit.consume(req.ip);
    const { email, password } = credentials(req.body),
      name = String(req.body?.name || '')
        .trim()
        .slice(0, 80);
    if (password.length < 10 || !name)
      throw tripError(
        'Enter your name and a password of at least 10 characters.',
      );
    const { data, error } = await client(req, res).auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: new URL('/auth/callback', site).href,
      },
    });
    if (error)
      throw tripError(
        error.status === 429
          ? 'Too many email requests. Please wait before trying again.'
          : 'Account creation could not be completed. Check your details and Supabase email settings.',
        error.status === 429 ? 429 : 400,
      );
    res.status(201).json({
      user: data.session ? profile(data.user) : null,
      confirmationRequired: !data.session,
      message: 'Check your email to confirm your account, then sign in.',
    });
  });
  router.post('/login', async (req, res) => {
    limit.consume(req.ip);
    const { data, error } = await client(req, res).auth.signInWithPassword(
      credentials(req.body),
    );
    if (error)
      throw tripError(
        error.code === 'email_not_confirmed'
          ? 'Confirm your email before signing in.'
          : 'Email or password is incorrect.',
        401,
      );
    res.json({ user: profile(data.user) });
  });
  router.post('/logout', async (req, res) => {
    const { error } = await client(req, res).auth.signOut({ scope: 'local' });
    if (error)
      throw tripError('Sign out could not be completed. Try again.', 503);
    res.status(204).end();
  });
  router.post('/forgot-password', async (req, res) => {
    limit.consume(req.ip);
    const email = String(req.body?.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw tripError('Enter your email address.');
    const state = randomBytes(24).toString('base64url'),
      redirect = new URL('/auth/callback', site);
    redirect.searchParams.set('recovery', state);
    const { error } = await client(req, res).auth.resetPasswordForEmail(email, {
      redirectTo: redirect.href,
    });
    if (error)
      throw tripError(
        'The reset email could not be sent. Please wait and try again.',
        error.status === 429 ? 429 : 503,
      );
    res.cookie('tracerisk_recovery_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || process.env.NODE_ENV === 'production',
      maxAge: 1800000,
      path: '/',
    });
    res.json({
      message:
        'If an account uses that email, a password-reset link will arrive shortly. Open it in this browser.',
    });
  });
  router.post('/password', async (req, res) => {
    limit.consume(req.ip);
    const user = await account(req, res);
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
    const sdk = client(req, res),
      checked = await sdk.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
    if (checked.error) throw tripError('Current password is incorrect.');
    const { error } = await sdk.auth.updateUser({ password });
    if (error)
      throw tripError('Password could not be updated. Please try again.');
    await sdk.auth.signOut({ scope: 'others' });
    res.json({ ok: true });
  });
  router.post('/reset-password', async (req, res) => {
    limit.consume(req.ip);
    const user = await account(req, res),
      password = req.body?.newPassword;
    const grant = parseCookieHeader(req.headers.cookie || '').find(
      (c) => c.name === 'tracerisk_recovery_grant',
    )?.value;
    if (!user || grant !== digest(req.supabaseAccessToken || ''))
      throw tripError('Open a fresh password-reset link in this browser.', 401);
    if (
      typeof password !== 'string' ||
      password.length < 10 ||
      password.length > 128
    )
      throw tripError('Use a password of 10–128 characters.');
    const { error } = await client(req, res).auth.updateUser({ password });
    if (error)
      throw tripError(
        'Password could not be updated. Request a new reset link.',
      );
    await client(req, res).auth.signOut({ scope: 'others' });
    res.clearCookie('tracerisk_recovery_grant', { path: '/' });
    res.json({ ok: true });
  });
  router.use((error, _req, res, _next) =>
    res.status(error.status || 503).json({
      error: error.status
        ? error.message
        : 'Sign-in is temporarily unavailable. Please try again.',
    }),
  );
  async function callback(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return res.redirect('/?authError=link');
    const { data, error } = await client(req, res).auth.exchangeCodeForSession(
      code,
    );
    if (error || !data.session) return res.redirect('/?authError=link');
    if (req.query.recovery) {
      const state = parseCookieHeader(req.headers.cookie || '').find(
        (c) => c.name === 'tracerisk_recovery_state',
      )?.value;
      if (!state || state !== req.query.recovery)
        return res.redirect('/?authError=link');
      res.cookie(
        'tracerisk_recovery_grant',
        digest(data.session.access_token),
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: req.secure || process.env.NODE_ENV === 'production',
          maxAge: 600000,
          path: '/',
        },
      );
      res.clearCookie('tracerisk_recovery_state', { path: '/' });
      return res.redirect('/reset-password');
    }
    return res.redirect('/');
  }
  return { router, account, callback };
}
