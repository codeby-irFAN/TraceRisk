import logo from '../../graphics/logo.png';
import { useCallback, useEffect, useState, useRef } from 'react';
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
import { api, place, when, dateRange, stored, remember } from './api';
import AuthPanel, { PasswordForm } from './AuthPanel';
import TripComposer from './TripComposer';
import TripDetails from './TripDetails';
export default function Workspace() {
  const [user, setUser] = useState(null),
    [authLoading, setAuthLoading] = useState(true),
    [authProvider, setAuthProvider] = useState('local'),
    [workspace, setWorkspace] = useState(null),
    [trips, setTrips] = useState([]),
    [selected, setSelected] = useState(null),
    [initialTab, setInitialTab] = useState('Overview'),
    [notice, setNotice] = useState(''),
    [trip, setTrip] = useState(null),
    [view, setView] = useState('Trips'),
    [composer, setComposer] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(
      new URLSearchParams(window.location.search).has('authError')
        ? 'This email link expired or was opened in a different browser. Sign in or request a new reset link.'
        : '',
    ),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [theme, setTheme] = useState(stored('tracerisk-theme') || 'light');
  useEffect(() => {
    let active = true;
    api('/auth/session')
      .then((data) => {
        if (active) {
          setUser(data.user);
          setAuthProvider(data.provider || 'local');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    const signedOut = () => {
      setUser(null);
      setWorkspace(null);
      setTrips([]);
      setTrip(null);
      setSelected(null);
      setComposer(false);
    };
    window.addEventListener('tracerisk:signout', signedOut);
    return () => {
      active = false;
      window.removeEventListener('tracerisk:signout', signedOut);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember('tracerisk-theme', theme);
  }, [theme]);
  const currentView = useRef({ userId: user?.id, selected });
  currentView.current = { userId: user?.id, selected };
  const refresh = useCallback(async () => {
    if (!user) return;
    const [w, list, detail] = await Promise.all([
      api('/workspace'),
      api('/trips'),
      selected ? api(`/trips/${selected}`) : Promise.resolve(null),
    ]);
    if (
      currentView.current.userId !== user.id ||
      currentView.current.selected !== selected
    )
      return;
    setWorkspace(w);
    setTrips(list.trips);
    if (detail) setTrip(detail.trip);
  }, [user, selected]);
  useEffect(() => {
    let active = true;
    const load = () =>
      refresh().catch((e) => {
        if (active) {
          setError(e.message);
          if (e.status === 401) {
            setUser(null);
            setTrips([]);
            setTrip(null);
            setSelected(null);
          }
        }
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
  async function save(draft) {
    const result = await api(
      editing ? `/trips/${editing.id}` : '/trips',
      draft,
      editing ? 'PUT' : 'POST',
    );
    setInitialTab('Overview');
    setNotice(
      editing
        ? 'Trip updated.'
        : 'Trip saved. Choose a check below to get started.',
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
      .includes(search.trim().toLowerCase()),
  );
  function open(t, tab = 'Overview') {
    setInitialTab(tab);
    setNotice('');
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
        <div className="rail-label">
          {user ? 'WORKSPACE' : 'TRAVEL PLANNING'}
        </div>
        {user && (
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
                aria-current={view === name ? 'page' : undefined}
                onClick={() => {
                  setNotice('');
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
        )}
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
            <Compass size={16} />{' '}
            {user ? `Your travel workspace / ${view}` : 'Welcome to TraceRisk'}
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
            {user && (
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
        {notice && (
          <div className="notice feedback" role="status">
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              ✕
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              ✕
            </button>
          </div>
        )}
        {user &&
          authProvider === 'supabase' &&
          workspace &&
          !workspace.monitoring && (
            <p className="notice">
              Automatic trip updates are not enabled yet. You can still check
              each trip manually.
            </p>
          )}
        {authLoading ? (
          <p role="status">Opening TraceRisk…</p>
        ) : !user ? (
          <AuthPanel
            provider={authProvider}
            onSignedIn={(user) => {
              setUser(user);
              setView('Trips');
              setSelected(null);
              setError('');
            }}
          />
        ) : !workspace ? (
          <p role="status">Loading your trips…</p>
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
                    monitoring={Boolean(workspace?.monitoring)}
                    initialTab={initialTab}
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
                {trips.length > 0 && (
                  <div className="metric-grid">
                    <div className="trip-card">
                      <span>SAVED TRIPS</span>
                      <strong>{trips.length}</strong>
                    </div>
                    <div className="trip-card">
                      <span>
                        {workspace?.monitoring
                          ? 'ON WATCH'
                          : 'READY FOR MANUAL CHECKS'}
                      </span>
                      <strong>
                        {
                          trips.filter(
                            (t) =>
                              !t.watchEnded &&
                              (!workspace?.monitoring || t.watch.enabled),
                          ).length
                        }
                      </strong>
                    </div>
                    <div className="trip-card">
                      <span>UNREAD UPDATES</span>
                      <strong>{unread}</strong>
                    </div>
                  </div>
                )}
                {trips.length === 0 ? (
                  <section className="getting-started trip-card">
                    <p className="eyebrow">YOUR FIRST TRIP</p>
                    <h2>From a plan to practical answers.</h2>
                    <ol className="start-steps">
                      <li>
                        <strong>Add your places</strong>
                        <span>
                          Choose a city or landmark and when you’ll visit.
                        </span>
                      </li>
                      <li>
                        <strong>Check your trip</strong>
                        <span>
                          Start with a quick check or look through more sources
                          with Thorough.
                        </span>
                      </li>
                      <li>
                        <strong>Know what to do next</strong>
                        <span>
                          Review travel updates, weather and checks before you
                          leave.
                        </span>
                      </li>
                    </ol>
                    <button
                      className="primary"
                      onClick={() => {
                        setEditing(null);
                        setComposer(true);
                      }}
                    >
                      Plan my first trip
                    </button>
                  </section>
                ) : (
                  <>
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
                              <th>Updates</th>
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
                                  {dateRange(
                                    t.stops[0].startDate,
                                    t.stops.at(-1).endDate,
                                  )}
                                </td>
                                <td>
                                  {t.watchEnded
                                    ? 'Finished'
                                    : !workspace?.monitoring
                                      ? 'Manual checks'
                                      : t.watch.enabled
                                        ? `Every ${t.watch.frequencyHours}h`
                                        : 'Paused'}
                                </td>
                                <td>{when(t.latest?.checkedAt)}</td>
                                <td>
                                  {t.latest?.issueCount ?? '—'} ·{' '}
                                  {t.unreadCount} unread
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
                                    : !workspace?.monitoring
                                      ? 'Manual checks'
                                      : t.watch.enabled
                                        ? '● On watch'
                                        : 'Watch paused'}
                              </span>
                              <ArrowUpRight size={20} />
                            </div>
                            <h2>{t.title}</h2>
                            <p>
                              {t.stops.map((s) => s.location.name).join(' → ')}
                            </p>
                            <small>
                              {dateRange(
                                t.stops[0].startDate,
                                t.stops.at(-1).endDate,
                              )}
                            </small>
                            <div className="trip-card-footer">
                              <span>
                                {t.client ||
                                  `${t.stops.length} stop${t.stops.length === 1 ? '' : 's'}`}
                              </span>
                              <span>
                                {t.latest
                                  ? `${t.latest.issueCount} updates`
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
                    {shown.length === 0 && (
                      <div className="empty-state" role="status">
                        <h3>No matching trips.</h3>
                        <p>Try another place, trip name or client.</p>
                        <button onClick={() => setSearch('')}>
                          Clear search
                        </button>
                      </div>
                    )}
                  </>
                )}
                {view === 'Travel desk' && (
                  <p className="notice">
                    Set your agency name, contact details and briefing colour in
                    Settings, then open a trip to prepare a briefing for your
                    client.
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
                    See what is new, what has changed and what needs your
                    attention.
                  </p>
                </div>
                {trips
                  .filter((t) => t.unreadCount)
                  .map((t) => (
                    <button
                      className="saved-trip"
                      key={t.id}
                      onClick={() => open(t, 'What changed')}
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
                        setNotice(
                          'Branding saved. New briefings will use these details.',
                        );
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
                <h3>Your account</h3>
                <p>
                  {user.name} · {user.email}
                </p>
                <PasswordForm />
                <h3>Trip Watch status</h3>
                <p>
                  {workspace?.monitoring
                    ? 'Your saved trips are checked automatically.'
                    : 'Automatic updates are currently paused. You can still check a trip yourself.'}
                </p>
                <p>
                  {!workspace?.persistent &&
                    'This demo does not keep trips after a restart.'}
                </p>
                <button
                  onClick={() => {
                    run(async () => {
                      await api('/auth/logout', {});
                      setUser(null);
                      setWorkspace(null);
                      setTrips([]);
                      setTrip(null);
                      setSelected(null);
                    });
                  }}
                >
                  Sign out
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
          monitoring={Boolean(workspace?.monitoring)}
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
