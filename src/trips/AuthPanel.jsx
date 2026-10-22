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
              {' '}
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
        <button
          className="auth-switch"
          disabled={busy}
          onClick={() => {
            setMode((m) =>
              m === 'forgot'
                ? 'login'
                : m === 'register'
                  ? 'login'
                  : 'register',
            );
            setError('');
            setMessage('');
          }}
        >
          {mode === 'register'
            ? 'Already have an account? Sign in'
            : mode === 'forgot'
              ? 'Back to sign in'
              : 'New here? Create an account'}
        </button>
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
