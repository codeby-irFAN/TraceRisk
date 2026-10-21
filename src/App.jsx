import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCircle2,
  CloudRain,
  Compass,
  ExternalLink,
  FileSearch,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react';
import DateField from './components/DateField.jsx';
import LocationChoices from './components/LocationChoices.jsx';
import TravelNotebook from './components/TravelNotebook.jsx';
import ScanResults from './components/ScanResults.jsx';
import useStoredState from './hooks/useStoredState.js';
import {
  CHECKLIST,
  datePreset,
  restorePlan,
  savePlan,
  tripDays,
  validPlans,
} from './planning.js';
import { localDate, plusDays, requestError } from './utils.js';

const suggestions = [
  'Jaipur',
  'Manali, Himachal Pradesh',
  'Goa',
  'Guwahati, Assam',
];
const validateChecklist = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  CHECKLIST.every(
    ({ id }) => value[id] === undefined || typeof value[id] === 'boolean',
  );
const validateTheme = (value) => value === 'light' || value === 'dark';

export default function App() {
  const today = useMemo(() => localDate(new Date()), []);
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(plusDays(today, 2));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [service, setService] = useState(null);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState('scan');
  const [elapsed, setElapsed] = useState(0);
  const [plans, setPlans, plansPersistent] = useStoredState(
    'tracerisk.plans.v1',
    [],
    validPlans,
  );
  const [checklist, setChecklist] = useStoredState(
    'tracerisk.checklist.v1',
    {},
    validateChecklist,
  );
  const [theme, setTheme] = useStoredState(
    'tracerisk.theme',
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    validateTheme,
  );
  const scanRef = useRef(null);
  const days = tripDays(startDate, endDate);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#15221c' : '#f6f4ed');
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Health check failed');
        return response.json();
      })
      .then(setService)
      .catch((error) => {
        if (error.name !== 'AbortError') setService(null);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => () => scanRef.current?.abort(), []);
  useEffect(() => {
    if (!loading) return undefined;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [loading]);

  function changeDestination(value) {
    setDestination(value);
    setLocations([]);
    setSelectedLocation(null);
    setNotice('');
    setChecklist({});
  }
  function chooseDates(kind) {
    const dates = datePreset(kind, today);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
    setChecklist({});
  }
  function storePlan() {
    setPlans((current) =>
      savePlan(current, { destination, startDate, endDate }),
    );
    setNotice(
      'Plan added to your notebook. Confirm the location when you are ready to scan.',
    );
  }
  function openPlan(plan) {
    const restored = restorePlan(plan, today);
    changeDestination(restored.destination);
    setStartDate(restored.startDate);
    setEndDate(restored.endDate);
    setResult(null);
    setError('');
    setNotice(
      restored.adjusted
        ? 'Plan restored. Past dates have been moved to today, keeping the same trip length. Confirm your destination again.'
        : 'Plan restored. Confirm your destination again to get a fresh briefing.',
    );
    document.getElementById('destination')?.focus();
  }
  function newScan() {
    setResult(null);
    setError('');
    setNotice('');
    document.getElementById('planner')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
    document.getElementById('destination')?.focus({ preventScroll: true });
  }
  async function runScan(event) {
    event.preventDefault();
    if (scanRef.current) return;
    const controller = new AbortController();
    scanRef.current = controller;
    const timeout = window.setTimeout(
      () =>
        controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      108_000,
    );
    setError('');
    setNotice('');
    setResult(null);
    setLoading(true);
    try {
      if (!selectedLocation) {
        setPhase('location');
        const response = await fetch(
          `/api/locations?destination=${encodeURIComponent(destination.trim())}`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            requestError(
              response,
              payload,
              'Could not find your destination. Please try again.',
            ),
          );
        if (!Array.isArray(payload.locations) || !payload.locations.length)
          throw new Error(
            'No matching destination in India was found. Try adding the district or state.',
          );
        setLocations(payload.locations);
        setNotice('Confirm the city and state below, then start your scan.');
        return;
      }
      setPhase('scan');
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim(),
          startDate,
          endDate,
          locationId: selectedLocation.id,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.code === 'LOCATION_REQUIRED') {
          setLocations([]);
          setSelectedLocation(null);
        }
        throw new Error(
          requestError(
            response,
            payload,
            `Scan failed (${response.status}). Please try again.`,
          ),
        );
      }
      if (
        !payload ||
        !Array.isArray(payload.issues) ||
        !Array.isArray(payload.sources) ||
        typeof payload.destination !== 'string'
      ) {
        throw new Error(
          'The server returned an incomplete scan. Please try again.',
        );
      }
      setResult(payload);
    } catch (scanError) {
      if (
        controller.signal.aborted &&
        controller.signal.reason?.message === 'Cancelled by traveller'
      ) {
        setNotice('Scan cancelled. You can change your trip and try again.');
      } else {
        setError(
          controller.signal.aborted
            ? 'The request took too long. Please try again; a timeout is not evidence that the destination is safe.'
            : scanError.message ||
                'Could not complete the scan. Check your connection and try again.',
        );
      }
    } finally {
      window.clearTimeout(timeout);
      scanRef.current = null;
      setLoading(false);
    }
  }

  return (
    <div className="app-shell" id="top">
      <a className="skip-link" href="#planner">
        Skip to trip planner
      </a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TraceRisk home">
          <span className="brand-mark">
            <Compass size={25} strokeWidth={1.6} />
          </span>
          <span className="brand-name">
            TraceRisk<span>THE TRAVEL FIELD GUIDE</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-planner" href="#planner">
            Plan a trip
          </a>
          <a href="#saved-plans">
            My notebook <span>{plans.length}</span>
          </a>
          {result && <a href="#briefing">My briefing</a>}
        </nav>
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          <span>{theme === 'light' ? 'Evening mode' : 'Daylight mode'}</span>
        </button>
      </header>
      <main>
        <section className="hero-layout" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" /> A LITTLE FORESIGHT GOES A LONG
              WAY
            </div>
            <h1 id="hero-title">
              Good journeys start
              <br />
              with <em>better context.</em>
            </h1>
            <p className="hero-subtitle">
              The road ahead. The weather coming in. The local story.
              <br className="desktop-break" /> A thoughtful travel briefing for
              wherever India takes you.
            </p>
            <a className="hero-anchor" href="#planner">
              Let's plan your next chapter <ArrowDown size={16} />
            </a>
          </div>
          <div className="field-note" aria-label="How your briefing works">
            <div className="field-note-heading">
              <Compass size={19} />
              <span>FIELD NOTES / INDIA</span>
              <span className="note-number">01</span>
            </div>
            <h2>
              Explore with curiosity. <br />
              Travel with context.
            </h2>
            <div className="field-note-line">
              <FileSearch size={17} />
              <span>Local news & official advisories</span>
            </div>
            <div className="field-note-line">
              <CloudRain size={17} />
              <span>Weather & river-flow outlooks</span>
            </div>
            <div className="field-note-line">
              <ShieldCheck size={17} />
              <span>Source links. Clear coverage gaps.</span>
            </div>
            <p>A little preparation. A little more peace of mind.</p>
          </div>
        </section>
        <div className="workspace-layout">
          <section
            className="search-panel"
            id="planner"
            aria-label="Travel scan details"
          >
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">YOUR NEXT CHAPTER</span>
                <h2>Where are we heading?</h2>
              </div>
              <span className="section-number">01 / PLAN</span>
            </div>
            <ol className="plan-steps" aria-label="Trip planning steps">
              <li className="is-current">
                <span>{selectedLocation ? <Check size={12} /> : '1'}</span>
                Choose a place
              </li>
              <li className={selectedLocation ? 'is-current' : ''}>
                <span>2</span>Confirm location
              </li>
              <li className={result ? 'is-current' : ''}>
                <span>3</span>Read your briefing
              </li>
            </ol>
            <form onSubmit={runScan}>
              <label htmlFor="destination">WHERE ARE YOU GOING?</label>
              <div className="destination-field">
                <MapPin size={19} />
                <input
                  disabled={loading}
                  id="destination"
                  autoComplete="off"
                  list="indian-destinations"
                  maxLength={90}
                  placeholder="A city, a hill town, somewhere new…"
                  value={destination}
                  onChange={(event) => changeDestination(event.target.value)}
                  required
                />
                <datalist id="indian-destinations">
                  {[
                    'Delhi',
                    'Mumbai',
                    'Bengaluru',
                    ...suggestions,
                    'Shimla, Himachal Pradesh',
                    'Kolkata',
                    'Chennai',
                    'Srinagar, Jammu and Kashmir',
                    'Pune',
                    'Hyderabad',
                  ].map((place) => (
                    <option value={place} key={place} />
                  ))}
                </datalist>
              </div>
              <div className="destination-suggestions">
                <span>A little inspiration</span>
                {suggestions.map((place) => (
                  <button
                    key={place}
                    type="button"
                    disabled={loading}
                    onClick={() => changeDestination(place)}
                  >
                    {place.split(',')[0]} <ArrowUpRight size={11} />
                  </button>
                ))}
              </div>
              <LocationChoices
                locations={locations}
                selected={selectedLocation}
                onSelect={(place) => {
                  setSelectedLocation(place);
                  setNotice('');
                  setChecklist({});
                }}
                disabled={loading}
              />
              <div className="date-label-row">
                <span>WHEN ARE YOU TRAVELLING?</span>
                {days > 0 && (
                  <span className="trip-duration">
                    {days} {days === 1 ? 'day' : 'days'} of discovery
                  </span>
                )}
              </div>
              <div className="date-grid">
                <DateField
                  disabled={loading}
                  label="FROM"
                  value={startDate}
                  min={today}
                  onChange={(next) => {
                    setStartDate(next);
                    if (next > endDate) setEndDate(next);
                    setChecklist({});
                  }}
                />
                <span className="date-arrow">
                  <ArrowRight size={16} />
                </span>
                <DateField
                  disabled={loading}
                  label="UNTIL"
                  value={endDate}
                  min={startDate || today}
                  onChange={(next) => {
                    setEndDate(next);
                    setChecklist({});
                  }}
                />
              </div>
              <div className="date-presets" aria-label="Quick trip dates">
                {[
                  ['three-days', 'A 3-day escape'],
                  ['weekend', 'This weekend'],
                  ['next-week', 'Next week'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={loading}
                    onClick={() => chooseDates(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {selectedLocation && (
                <div className="confirmed-place">
                  <CheckCircle2 size={16} />
                  <span>Selected: {selectedLocation.label}</span>
                </div>
              )}
              <div className="planner-actions">
                <button
                  className="scan-button"
                  type="submit"
                  disabled={
                    loading ||
                    (locations.length > 0 && !selectedLocation) ||
                    destination.trim().length < 2 ||
                    !days
                  }
                >
                  {loading ? (
                    <>
                      <span className="button-spinner" />{' '}
                      {phase === 'location'
                        ? 'Finding your place'
                        : 'Preparing your briefing'}
                    </>
                  ) : (
                    <>
                      {selectedLocation ? 'Check my trip' : 'Find destination'}{' '}
                      <ArrowUpRight size={18} />
                    </>
                  )}
                </button>
                <button
                  className="save-plan-button"
                  type="button"
                  disabled={loading || destination.trim().length < 2 || !days}
                  onClick={storePlan}
                >
                  <Bookmark size={16} /> Save plan
                </button>
              </div>
              <p className="panel-trust">
                <ShieldCheck size={15} />
                We'll show the evidence, and tell you where it's missing.
              </p>
            </form>
            {loading && (
              <section className="loading-panel" aria-label="Scan progress">
                <span className="loading-compass">
                  <Compass size={28} strokeWidth={1.3} />
                </span>
                <div className="loading-copy">
                  <span className="panel-kicker">
                    {phase === 'location'
                      ? 'FINDING YOUR PLACE'
                      : 'GATHERING THE CONTEXT'}
                  </span>
                  <h3>
                    {phase === 'location'
                      ? 'Finding your destination'
                      : 'Good context takes a moment.'}
                  </h3>
                  <p>
                    {phase === 'location'
                      ? 'Looking up cities and states so your briefing covers the right place.'
                      : `Reviewing sources and forecasts for ${selectedLocation?.label || destination}. This can take up to 100 seconds.`}
                  </p>
                </div>
                <span className="elapsed-time">
                  <Timer size={15} />
                  {Math.floor(elapsed / 60)}:
                  {String(elapsed % 60).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    scanRef.current?.abort(
                      new DOMException('Cancelled by traveller', 'AbortError'),
                    )
                  }
                >
                  Cancel scan
                </button>
              </section>
            )}
            {notice && !loading && (
              <p className="scan-notice" role="status">
                <CheckCircle2 size={17} />
                {notice}
              </p>
            )}
            {error && !loading && (
              <section className="error-panel" role="alert">
                <TriangleAlert size={23} />
                <div>
                  <h3>We couldn't complete that scan.</h3>
                  <p>{error}</p>
                  <small>
                    A failed scan never means the destination is safe. Check
                    official advisories for urgent updates.
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                >
                  <X size={18} />
                </button>
              </section>
            )}
            <div className="config-strip">
              <span>
                <i
                  className={service?.tinyfishConfigured ? 'status-ready' : ''}
                />
                {service === null
                  ? 'Checking connection'
                  : service.tinyfishConfigured
                    ? 'Live updates connected'
                    : 'Live updates unavailable'}
              </span>
              <span>INDIA · DOMESTIC TRAVEL</span>
            </div>
          </section>
          <TravelNotebook
            plans={plans}
            onRestore={openPlan}
            onRemove={(id) =>
              setPlans((current) => current.filter((plan) => plan.id !== id))
            }
            checklist={checklist}
            onToggle={(id) =>
              setChecklist((current) => ({ ...current, [id]: !current[id] }))
            }
            persistent={plansPersistent}
            loading={loading}
          />
        </div>
        {result && !loading && (
          <ScanResults result={result} onNewScan={newScan} />
        )}
        {!result && !loading && (
          <section className="how-it-works" aria-labelledby="how-title">
            <div>
              <span className="panel-kicker">
                A CLEARER PICTURE, IN THREE STEPS
              </span>
              <h2 id="how-title">
                Less guesswork. <br />
                <em>More going places.</em>
              </h2>
            </div>
            <article>
              <span>01</span>
              <h3>Make it your trip.</h3>
              <p>
                Choose your destination, confirm the right place, and add your
                dates.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Look a little closer.</h3>
              <p>
                Review local reports, travel notices, and forecasts with their
                sources.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Go better prepared.</h3>
              <p>
                Keep your briefing, check official advice, and stay open to a
                change of plans.
              </p>
            </article>
          </section>
        )}
        <section className="responsible-note">
          <ShieldCheck size={20} strokeWidth={1.5} />
          <p>
            A companion to your own judgement. TraceRisk is a prototype for
            travel awareness, not an official safety rating or a guarantee of
            safety.
          </p>
          <a href="https://mausam.imd.gov.in/" target="_blank" rel="noreferrer">
            Check IMD advisories <ExternalLink size={13} />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <a className="footer-brand" href="#top">
          <Compass size={18} /> TraceRisk
        </a>
        <span>Made for the thoughtfully curious.</span>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo <ArrowUpRight size={12} />
        </a>
      </footer>
    </div>
  );
}
