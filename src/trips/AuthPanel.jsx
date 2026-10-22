import { useState } from 'react';
import { api, stored, remember } from './api';
export default function AuthPanel({ onSignedIn }) {
  const [mode, setMode] = useState('register'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = Object.fromEntries(new FormData(e.currentTarget));
    body.legacyKey = stored('tracerisk-workspace-key') || undefined;
    try {
      const { user } = await api(`/auth/${mode}`, body);
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
        <h2>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
        <p>
          {mode === 'register'
            ? 'Save your trips and pick up where you left off.'
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
          {mode === 'register' && <small>Use at least 10 characters.</small>}
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
                : 'Sign in'}
          </button>
        </form>
        <button
          className="auth-switch"
          disabled={busy}
          onClick={() => {
            setMode((m) => (m === 'register' ? 'login' : 'register'));
            setError('');
          }}
        >
          {mode === 'register'
            ? 'Already have an account? Sign in'
            : 'New here? Create an account'}
        </button>
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
      setMessage('Password updated. Other devices have been signed out.');
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
