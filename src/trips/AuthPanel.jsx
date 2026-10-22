import { useState } from 'react';
import { api, stored, remember } from './api';
export default function AuthPanel({ onSignedIn, provider = 'local' }) {
  const [mode, setMode] = useState('register'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const body = Object.fromEntries(new FormData(e.currentTarget));
    body.legacyKey = stored('tracerisk-workspace-key') || undefined;
    try {
      const data = await api(
        `/auth/${mode === 'forgot' ? 'forgot-password' : mode}`,
        body,
      );
      if (data.confirmationRequired || mode === 'forgot') {
        setMessage(data.message);
        if (mode !== 'forgot') setMode('login');
        return;
      }
      const { user } = data;
      remember('tracerisk-workspace-key', null);
      onSignedIn(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-welcome auth-welcome">
      <div>
        <p className="eyebrow">PLAN WELL. TRAVEL PREPARED.</p>
        <h1>
          Your trip.
          <br />
          One clear plan.
        </h1>
        <p>
          Save your itinerary, check what could affect your journey and keep up
          with changes.
        </p>
        <div className="auth-benefits">
          <p>✓ Cities, landmarks and places you want to visit</p>
          <p>✓ Travel updates with sources you can open</p>
          <p>✓ Saved trips available when you sign in</p>
        </div>
      </div>
      <div className="trip-card auth-card">
        {mode !== 'forgot' && (
          <div
            className="auth-mode-tabs"
            role="tablist"
            aria-label="Account access"
          >
            {[
              ['login', 'Sign in'],
              ['register', 'Create account'],
            ].map(([value, label]) => (
              <button
                type="button"
                role="tab"
                key={value}
                aria-selected={mode === value}
                disabled={busy}
                onClick={() => {
                  setMode(value);
                  setError('');
                  setMessage('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <h2>
          {mode === 'register'
            ? 'Create your account'
            : mode === 'forgot'
              ? 'Reset your password'
              : 'Welcome back'}
        </h2>
        <p>
          {mode === 'register'
            ? 'Save your trips and pick up where you left off.'
            : mode === 'forgot'
              ? 'Enter your email to receive a reset link.'
              : 'Sign in to see your saved trips.'}
        </p>
        {provider === 'supabase' && mode !== 'forgot' && (
          <>
            <button
              type="button"
              className="google-signin"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const data = await api('/auth/google', {});
                  const target = new URL(data.url);
                  if (target.protocol !== 'https:')
                    throw new Error('Google sign-in could not start.');
                  window.location.assign(target.href);
                } catch (e) {
                  setError(e.message);
                  setBusy(false);
                }
              }}
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
              >
                <path
                  fill="#4285F4"
                  d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.4c2-1.8 2.8-4.4 2.8-7.5z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.7 0 5-.9 6.8-2.3l-3.4-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10.2 10.2 0 0 0 12 22z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10.2 10.2 0 0 0-9 5.5l3.4 2.7C7.2 7.8 9.4 6 12 6z"
                />
              </svg>
              Continue with Google
            </button>
            <div className="auth-divider">
              <span>or use email</span>
            </div>
          </>
        )}
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Your name
              <input name="name" required maxLength={80} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </label>
          {mode !== 'forgot' && (
            <>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === 'register' ? 10 : 1}
                  maxLength={128}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                />
              </label>
            </>
          )}
          {mode === 'register' && <small>Use at least 10 characters.</small>}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'register'
                ? 'Create account'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Sign in'}
          </button>
        </form>
        {mode === 'forgot' && (
          <button
            type="button"
            className="auth-switch"
            disabled={busy}
            onClick={() => {
              setMode('login');
              setError('');
              setMessage('');
            }}
          >
            Back to sign in
          </button>
        )}
        {provider === 'supabase' && mode === 'login' && (
          <button
            className="auth-switch"
            onClick={() => {
              setMode('forgot');
              setMessage('');
              setError('');
            }}
          >
            Forgot password?
          </button>
        )}
        <p className="muted">
          You can also{' '}
          <a href="/check">check a destination without signing in</a>.
        </p>
      </div>
    </section>
  );
}
export function PasswordForm() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage('');
    try {
      await api('/auth/password', Object.fromEntries(new FormData(form)));
      form.reset();
      setMessage('Password updated.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Change password</summary>
      <form onSubmit={submit}>
        <label>
          Current password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          New password
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
          />
        </label>
        <button disabled={busy}>Update password</button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
