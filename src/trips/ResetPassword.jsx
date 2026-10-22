import { useState } from 'react';
import { api } from './api';
export default function ResetPassword() {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        '/auth/reset-password',
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setDone(true);
      setMessage('Your password has been updated.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="trip-workspace shared-page">
      <section className="trip-card">
        <h1>Choose a new password</h1>
        {!done && (
          <form onSubmit={submit}>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Save password
            </button>
          </form>
        )}
        <p role="status">{message}</p>
        <a href="/">Return to TraceRisk</a>
      </section>
    </main>
  );
}
