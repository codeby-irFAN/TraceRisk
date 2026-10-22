import ResetPassword from './trips/ResetPassword';
import { useEffect, useState } from 'react';
import QuickCheck from './QuickCheck';
import Workspace from './trips/Workspace';
import { Briefing } from './trips/TripDetails';
import { api } from './trips/api';
import './trips/workspace.css';
function Shared({ token }) {
  const [data, setData] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    api(`/shared/${encodeURIComponent(token)}`, undefined, 'GET')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="shared-page trip-workspace">
      {error ? (
        <p role="alert">{error}</p>
      ) : data ? (
        <Briefing data={data} />
      ) : (
        <p>Opening briefing…</p>
      )}
      <a className="no-print" href="/">
        Open TraceRisk
      </a>
    </main>
  );
}
export default function App() {
  const path = window.location.pathname;
  if (path === '/reset-password') return <ResetPassword />;
  if (path === '/check')
    return (
      <>
        <a className="quick-workspace-link" href="/">
          ← Trip workspace
        </a>
        <QuickCheck />
      </>
    );
  if (path.startsWith('/share/')) return <Shared token={path.slice(7)} />;
  return <Workspace />;
}
