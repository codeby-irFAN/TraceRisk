import logo from '../../graphics/logo.png';
import { useCallback, useEffect, useState } from 'react';
import {
  Compass,
  MapPinned,
  Bell,
  BriefcaseBusiness,
  Settings,
  Plus,
  Moon,
  Sun,
  ArrowUpRight,
} from 'lucide-react';
import {
  api,
  place,
  when,
  workspaceKey,
  storeKey,
  stored,
  remember,
} from './api';
import TripComposer from './TripComposer';
import TripDetails from './TripDetails';
export default function Workspace() {
  const [key, setKey] = useState(workspaceKey),
    [workspace, setWorkspace] = useState(null),
    [trips, setTrips] = useState([]),
    [selected, setSelected] = useState(null),
    [trip, setTrip] = useState(null),
    [view, setView] = useState('Trips'),
    [composer, setComposer] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [restore, setRestore] = useState(''),
    [search, setSearch] = useState(''),
    [theme, setTheme] = useState(stored('tracerisk-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember('tracerisk-theme', theme);
  }, [theme]);
  const refresh = useCallback(async () => {
    if (!key) return;
    const [w, list, detail] = await Promise.all([
      api('/workspace'),
      api('/trips'),
      selected ? api(`/trips/${selected}`) : Promise.resolve(null),
    ]);
    setWorkspace(w);
    setTrips(list.trips);
    if (detail) setTrip(detail.trip);
  }, [key, selected]);
  useEffect(() => {
    let active = true;
    const load = () =>
      refresh().catch((e) => {
        if (active) setError(e.message);
      });
    load();
    const timer = setInterval(load, trip?.checking ? 3000 : 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh, trip?.checking]);
  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await run(async () => {
      const data = await api('/workspaces', {});
      storeKey(data.key);
      setKey(data.key);
    });
  }
  async function save(draft) {
    const result = await api(
      editing ? `/trips/${editing.id}` : '/trips',
      draft,
      editing ? 'PUT' : 'POST',
    );
    setSelected(result.trip.id);
    setTrip(result.trip);
    setComposer(false);
    setEditing(null);
    setView('Trips');
    await refresh();
  }
  async function act(action, body = {}, method = 'POST') {
    await run(async () => {
      await api(
        `/trips/${trip.id}${action ? `/${action}` : ''}`,
        method === 'DELETE' ? undefined : body,
        method,
      );
      if (method === 'DELETE') {
        setSelected(null);
        setTrip(null);
      } else if (action === 'check' || action === 'compare')
        setTrip((t) => ({ ...t, checking: true }));
      await refresh();
    });
  }
  const unread = trips.reduce((n, t) => n + t.unreadCount, 0);
  const shown = trips.filter((t) =>
    `${t.title} ${t.client} ${t.stops.map((s) => place(s.location)).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function open(t) {
    setTrip(null);
    setSelected(t.id);
    setView('Trips');
  }
  return (
    <div className="trip-workspace">
      <aside className="workspace-rail">
        <a href="/" className="workspace-brand">
          <img src={logo} alt="" />
          <strong>
            TraceRisk<span>YOUR TRAVEL FIELD GUIDE</span>
          </strong>
        </a>
        <div className="rail-label">WORKSPACE</div>
        <nav>
          {[
            ['Trips', MapPinned],
            ['Updates', Bell],
            ['Travel desk', BriefcaseBusiness],
            ['Settings', Settings],
          ].map(([name, Icon]) => (
            <button
              className={view === name ? 'active' : ''}
              key={name}
              onClick={() => {
                setView(name);
                if (name !== 'Trips') setSelected(null);
              }}
            >
              <Icon size={19} />
              {name}
              {name === 'Updates' && unread > 0 && (
                <span className="nav-count">{unread}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <p>
            More clarity.
            <br />
            Better journeys.
          </p>
          <a href="/check">
            Quick destination check <ArrowUpRight size={15} />
          </a>
          <button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}{' '}
            {theme === 'light' ? 'Dark' : 'Light'} appearance
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-top">
          <span>
            <Compass size={16} /> Trip intelligence / {view}
          </span>
          <div className="inline">
            <button
              aria-label="Toggle colour theme"
              onClick={() =>
                setTheme((t) => (t === 'light' ? 'dark' : 'light'))
              }
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            {key && (
              <button
                className="primary"
                onClick={() => {
                  setEditing(null);
                  setComposer(true);
                }}
              >
                <Plus size={16} /> New trip
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              ✕
            </button>
          </div>
        )}
        {!key ? (
          <section className="workspace-welcome">
            <p className="eyebrow">A LITTLE MORE PREPARED. EVERY STEP.</p>
            <h1>Follow the whole journey.</h1>
            <p>
              Plan your stops, understand the evidence and keep an eye on what
              changes. One calm place for your next trip.
            </p>
            <button className="primary" disabled={busy} onClick={create}>
              Create my private workspace <ArrowUpRight size={17} />
            </button>
            <div className="welcome-features">
              {[
                [
                  '01',
                  'Plan the route',
                  'Check your stops and supported road corridors.',
                ],
                [
                  '02',
                  'Watch for changes',
                  'Keep meaningful updates in one trip timeline.',
                ],
                [
                  '03',
                  'Travel with context',
                  'Inspect sources and share a clear briefing.',
                ],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span>{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
            <details>
              <summary>Already have a workspace? Restore it</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api('/workspace', undefined, 'GET', restore.trim());
                    storeKey(restore.trim());
                    setKey(restore.trim());
                  });
                }}
              >
                <label>
                  Recovery key
                  <input
                    type="password"
                    value={restore}
                    onChange={(e) => setRestore(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button disabled={busy}>Restore workspace</button>
              </form>
            </details>
            <p className="muted">
              Your recovery key stays in this browser. Save a copy in Settings
              to reopen your trips on another device.
            </p>
          </section>
        ) : (
          <>
            {view === 'Trips' && selected ? (
              trip ? (
                <>
                  <button
                    className="back-link"
                    onClick={() => {
                      setSelected(null);
                      setTrip(null);
                    }}
                  >
                    ← All trips
                  </button>
                  <TripDetails
                    key={trip.id}
                    trip={trip}
                    agency={workspace?.workspace}
                    act={act}
                    refresh={refresh}
                    onEdit={() => {
                      setEditing(trip);
                      setComposer(true);
                    }}
                  />
                </>
              ) : (
                <p role="status">Opening your trip…</p>
              )
            ) : null}
            {((view === 'Trips' && !selected) || view === 'Travel desk') && (
              <>
                <div className="page-intro">
                  <p className="eyebrow">
                    {view === 'Travel desk'
                      ? 'A CLEARER VIEW FOR EVERY CLIENT'
                      : 'THE JOURNEY, WITH CONTEXT'}
                  </p>
                  <h1>
                    {view === 'Travel desk'
                      ? workspace?.workspace?.agencyName || 'Your travel desk'
                      : 'Good plans start here.'}
                  </h1>
                  <p>
                    {view === 'Travel desk'
                      ? 'Manage client itineraries, monitor changes and prepare branded briefings.'
                      : 'Your itineraries, evidence and next steps — together.'}
                  </p>
                </div>
                <div className="metric-grid">
                  <div className="trip-card">
                    <span>SAVED TRIPS</span>
                    <strong>{trips.length}</strong>
                  </div>
                  <div className="trip-card">
                    <span>ON WATCH</span>
                    <strong>
                      {
                        trips.filter((t) => t.watch.enabled && !t.watchEnded)
                          .length
                      }
                    </strong>
                  </div>
                  <div className="trip-card">
                    <span>UNREAD UPDATES</span>
                    <strong>{unread}</strong>
                  </div>
                </div>
                <div className="section-head">
                  <h2>
                    {view === 'Travel desk' ? 'Client trips' : 'Your trips'}
                  </h2>
                  <input
                    aria-label="Filter trips"
                    className="trip-filter"
                    placeholder="Search trips, clients or places"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {view === 'Travel desk' && shown.length > 0 ? (
                  <div className="table-scroll">
                    <table className="agent-table">
                      <thead>
                        <tr>
                          <th>Client / trip</th>
                          <th>Dates</th>
                          <th>Watch</th>
                          <th>Latest check</th>
                          <th>Signals</th>
                          <th>Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <strong>{t.client || 'Personal trip'}</strong>
                              <br />
                              {t.title}
                            </td>
                            <td>
                              {t.stops[0].startDate}
                              <br />
                              {t.stops.at(-1).endDate}
                            </td>
                            <td>
                              {t.watchEnded
                                ? 'Finished'
                                : t.watchEnded
                                  ? 'Finished'
                                  : t.watch.enabled
                                    ? `Every ${t.watch.frequencyHours}h`
                                    : 'Paused'}
                            </td>
                            <td>{when(t.latest?.checkedAt)}</td>
                            <td>
                              {t.latest?.issueCount ?? '—'} · {t.unreadCount}{' '}
                              unread
                            </td>
                            <td>
                              <button onClick={() => open(t)}>
                                Manage / brief
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="trip-grid">
                    {shown.map((t) => (
                      <button
                        className="saved-trip"
                        key={t.id}
                        onClick={() => open(t)}
                      >
                        <div className="section-head">
                          <span className="pill">
                            {t.checking
                              ? 'Checking…'
                              : t.watchEnded
                                ? 'Finished'
                                : t.watch.enabled
                                  ? '● On watch'
                                  : 'Watch paused'}
                          </span>
                          <ArrowUpRight size={20} />
                        </div>
                        <h2>{t.title}</h2>
                        <p>{t.stops.map((s) => s.location.name).join(' → ')}</p>
                        <small>
                          {t.stops[0].startDate} → {t.stops.at(-1).endDate}
                        </small>
                        <div className="trip-card-footer">
                          <span>{t.client || `${t.stops.length} stops`}</span>
                          <span>
                            {t.latest
                              ? `${t.latest.issueCount} signals`
                              : 'Ready to check'}
                            {t.unreadCount ? ` · ${t.unreadCount} new` : ''}
                          </span>
                        </div>
                      </button>
                    ))}
                    <button
                      className="new-trip-card"
                      onClick={() => {
                        setEditing(null);
                        setComposer(true);
                      }}
                    >
                      <Plus size={28} />
                      <h3>Make room for a new journey.</h3>
                      <span>Plan a trip</span>
                    </button>
                  </div>
                )}
                {view === 'Travel desk' && (
                  <p className="notice">
                    Set your agency name, contact details and briefing colour in
                    Settings. This is one private workspace; shared team roles,
                    billing and client logins are not included.
                  </p>
                )}
              </>
            )}
            {view === 'Updates' && (
              <>
                <div className="page-intro">
                  <p className="eyebrow">WHAT CHANGED</p>
                  <h1>Keep the useful updates.</h1>
                  <p>
                    Review a trip’s timeline for new, changed, resolved and
                    no-longer-observed reports.
                  </p>
                </div>
                {trips
                  .filter((t) => t.unreadCount)
                  .map((t) => (
                    <button
                      className="saved-trip"
                      key={t.id}
                      onClick={() => open(t)}
                    >
                      <h2>{t.title}</h2>
                      <p>{t.unreadCount} unread updates · Open timeline →</p>
                    </button>
                  ))}
                {!unread && (
                  <div className="empty-state">
                    <Bell size={32} />
                    <h2>You’re up to date.</h2>
                    <p>
                      Meaningful changes from completed Trip Watch checks will
                      appear here.
                    </p>
                  </div>
                )}
              </>
            )}
            {view === 'Settings' && (
              <section className="trip-card settings-panel">
                <p className="eyebrow">MAKE IT YOURS</p>
                <h1>Workspace settings</h1>
                {workspace && (
                  <form
                    key={workspace.workspace.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      run(async () => {
                        await api(
                          '/workspace',
                          Object.fromEntries(data),
                          'PATCH',
                        );
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Agency / workspace name
                      <input
                        name="agencyName"
                        defaultValue={workspace.workspace.agencyName}
                        maxLength={80}
                      />
                    </label>
                    <label>
                      Contact shown on briefings
                      <input
                        name="contact"
                        defaultValue={workspace.workspace.contact}
                        maxLength={160}
                      />
                    </label>
                    <label>
                      Briefing accent colour
                      <input
                        type="color"
                        name="color"
                        defaultValue={workspace.workspace.color}
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Save branding
                    </button>
                  </form>
                )}
                <h3>Workspace recovery key</h3>
                <p>
                  Anyone with this key can access your trips. Store it
                  privately. There is no email-based recovery.
                </p>
                <details>
                  <summary>Show recovery key</summary>
                  <code className="recovery-key">{key}</code>
                  <button
                    onClick={() =>
                      run(() => navigator.clipboard.writeText(key))
                    }
                  >
                    Copy key
                  </button>
                </details>
                <h3>Trip Watch status</h3>
                <p>
                  {workspace?.monitoring
                    ? 'Scheduled monitoring is running.'
                    : 'Scheduled monitoring is disabled on this server. Manual checks remain available.'}
                </p>
                <p>
                  {workspace?.persistent
                    ? 'This server saves trips to a database. Your host must retain its database disk across deployments.'
                    : 'This server uses temporary storage. Trips will be lost when it restarts.'}
                </p>
                <button
                  onClick={() => {
                    storeKey(null);
                    setKey(null);
                    setWorkspace(null);
                    setTrips([]);
                    setTrip(null);
                    setSelected(null);
                  }}
                >
                  Lock / leave workspace on this browser
                </button>
              </section>
            )}
          </>
        )}
        <footer className="workspace-footer">
          TraceRisk · Evidence for better travel decisions.
          <span>
            Conditions change. Verify important details before departure.
          </span>
        </footer>
      </main>
      {composer && (
        <TripComposer
          initial={editing}
          onSave={save}
          onClose={() => {
            setComposer(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
