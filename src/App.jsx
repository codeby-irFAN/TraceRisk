import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CloudRain,
  ExternalLink,
  FileSearch,
  MapPin,
  RefreshCw,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  CarFront,
  TrainFront,
  Users,
  HeartPulse,
  Footprints,
  Building2,
  Newspaper,
  Clock3,
  Search,
} from 'lucide-react';

import DateField from './components/DateField.jsx';
import IssueCard from './components/IssueCard.jsx';
import WeatherPanel from './components/WeatherPanel.jsx';
import {
  localDate,
  plusDays,
  prettyDate,
  formatDuration,
  severityClass,
  friendlyModelName,
} from './utils.js';

const loadingSteps = [
  'Finding useful local updates',
  'Checking travel, safety and public-service reports',
  'Reviewing source pages and weather forecasts',
  'Preparing your travel briefing',
];

const laneIcons = {
  traffic: CarFront,
  transport: TrainFront,
  'civil-unrest': Users,
  'official-advisories': ShieldAlert,
  health: HeartPulse,
  crime: Footprints,
  infrastructure: Building2,
  'regional-news': Newspaper,
};

function sourceMap(sources = []) {
  return new Map(sources.map((source) => [source.id, source]));
}

export default function App() {
  const today = useMemo(() => localDate(new Date()), []);
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(plusDays(today, 3));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingStep, setLoadingStep] = useState(0);
  const [service, setService] = useState(null);
  const appRef = useRef(null);
  const scanRef = useRef(null);
  const resultSources = useMemo(
    () => sourceMap(result?.sources || []),
    [result],
  );

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.topbar',
        { y: -10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, ease: 'power2.out' },
      );
      gsap.fromTo(
        '.hero-copy',
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, delay: 0.08, ease: 'power3.out' },
      );
      gsap.fromTo(
        '.search-panel',
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.65, delay: 0.16, ease: 'power3.out' },
      );
    }, appRef);
    return () => ctx.revert();
  }, []);

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
    const timer = window.setInterval(
      () => setLoadingStep((current) => (current + 1) % loadingSteps.length),
      2800,
    );
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (
      !result ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.result-reveal',
        { y: 12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, stagger: 0.05, ease: 'power2.out' },
      );
      gsap.fromTo(
        '.issue-card',
        { y: 12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, stagger: 0.07, ease: 'power2.out' },
      );
    }, appRef);
    return () => ctx.revert();
  }, [result]);

  async function runScan(event) {
    event.preventDefault();
    if (scanRef.current) return;
    const controller = new AbortController();
    scanRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 108_000);
    setError('');
    setResult(null);
    setLoading(true);
    setLoadingStep(0);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim(),
          startDate,
          endDate,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          payload?.error ||
            `Scan failed (${response.status}). Please try again.`,
        );
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
      setError(
        scanError.name === 'AbortError'
          ? 'The scan took too long. Please try again; a timeout is not evidence that the destination is safe.'
          : scanError.message ||
              'Could not complete the scan. Check your connection and try again.',
      );
    } finally {
      window.clearTimeout(timeout);
      scanRef.current = null;
      setLoading(false);
    }
  }

  const hasResult = Boolean(result);
  const coverage = result?.coverageStatus || 'inconclusive';
  const inconclusive = coverage === 'inconclusive';
  const limited = coverage === 'limited';
  const rulesMode = result?.analysisMode === 'rules';
  const weather = result?.weather;
  const laneStats =
    result?.searchLaneStats || result?.sourceHealth?.searchLanes || [];
  const fetchedWeb = Number(result?.pagesFetched || 0);

  return (
    <div id="top" className="app-shell" ref={appRef}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TraceRisk home">
          <span className="brand-mark">
            <ShieldCheck size={19} strokeWidth={2.2} />
          </span>
          <span className="brand-name">
            Trace<span>Risk</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-product">INDIA TRAVEL CHECK</span>
        </a>
        <div className="topbar-right">
          <span className="scope-label">
            <span className="scope-dot" /> INDIA / DOMESTIC
          </span>
          <a
            className="top-link"
            href="https://mausam.imd.gov.in/"
            target="_blank"
            rel="noreferrer"
          >
            IMD advisories <ArrowUpRight size={14} />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero-layout">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" /> YOUR TRIP, BETTER PREPARED
            </div>
            <h1>
              Know before
              <br />
              <span>you go.</span>
            </h1>
            <p className="hero-subtitle">
              Check the things that could interrupt your trip — local updates,
              transport, safety notices and weather — in one simple travel
              briefing.
            </p>
            <div className="hero-footnote">
              <Radio size={15} />
              <span>LOCAL UPDATES</span>
              <i /> <span>WEATHER & FLOOD</span>
              <i /> <span>AI-ASSISTED REVIEW</span>
            </div>
            <div className="architecture-chips">
              <span>
                <Search size={13} /> Local news & advisories
              </span>
              <span>
                <CloudRain size={13} /> Weather & flood outlook
              </span>
              <span>
                <Sparkles size={13} /> Gemini first · Groq fallback
              </span>
            </div>
          </div>

          <section className="search-panel" aria-label="Travel scan details">
            <div className="panel-heading">
              <div>
                <div className="panel-kicker">PLAN YOUR JOURNEY</div>
                <h2>Check your destination</h2>
              </div>
              <div className="panel-icon">
                <FileSearch size={20} />
              </div>
            </div>
            <form onSubmit={runScan}>
              <label htmlFor="destination">WHERE ARE YOU GOING?</label>
              <div className="destination-field">
                <MapPin size={18} />
                <input
                  disabled={loading}
                  id="destination"
                  autoComplete="off"
                  list="indian-destinations"
                  maxLength={90}
                  placeholder="e.g. Imphal, Manipur"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  required
                />
                <datalist id="indian-destinations">
                  {[
                    'Delhi',
                    'Mumbai',
                    'Bengaluru',
                    'Jaipur',
                    'Manali, Himachal Pradesh',
                    'Shimla, Himachal Pradesh',
                    'Dehradun, Uttarakhand',
                    'Goa',
                    'Kolkata',
                    'Chennai',
                    'Guwahati, Assam',
                    'Imphal, Manipur',
                    'Gangtok, Sikkim',
                    'Shillong, Meghalaya',
                    'Kohima, Nagaland',
                    'Srinagar, Jammu and Kashmir',
                    'Pune',
                    'Hyderabad',
                  ].map((place) => (
                    <option value={place} key={place} />
                  ))}
                </datalist>
              </div>
              <div className="date-label-row">
                <span>WHEN ARE YOU TRAVELLING?</span>
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
                  }}
                />
                <div className="date-arrow">
                  <ArrowRight size={15} />
                </div>
                <DateField
                  disabled={loading}
                  label="UNTIL"
                  value={endDate}
                  min={startDate || today}
                  onChange={setEndDate}
                />
              </div>
              <button
                className="scan-button"
                type="submit"
                disabled={
                  loading ||
                  !destination.trim() ||
                  !startDate ||
                  !endDate ||
                  startDate > endDate
                }
              >
                {loading ? (
                  <>
                    <span className="button-spinner" /> CHECKING YOUR TRIP
                  </>
                ) : (
                  <>
                    Check my destination <ArrowUpRight size={17} />{' '}
                  </>
                )}
              </button>
              <div className="panel-trust">
                <ShieldCheck size={14} />
                <span>
                  We'll show what we found — and tell you when there isn't
                  enough information.
                </span>
              </div>
              <div className="config-strip">
                <span
                  className={
                    service?.tinyfishConfigured ? 'config-ok' : 'config-missing'
                  }
                >
                  <i />{' '}
                  {service?.tinyfishConfigured
                    ? 'Live updates connected'
                    : 'Live updates unavailable'}
                </span>
                <span
                  className={
                    service?.llmConfigured ? 'config-ok' : 'config-missing'
                  }
                >
                  <i />{' '}
                  {service?.geminiConfigured && service?.groqConfigured
                    ? 'Gemini primary · Groq backup'
                    : service?.geminiConfigured
                      ? 'Gemini ready · no Groq backup'
                      : service?.groqConfigured
                        ? 'Groq only · add Gemini for primary'
                        : 'Basic review only'}
                </span>
              </div>
            </form>
          </section>
        </section>

        {loading && (
          <section className="loading-panel result-reveal" aria-live="polite">
            <div className="loading-orbit">
              <span />
              <span />
              <span />
              <ShieldCheck size={22} />
            </div>
            <div className="loading-copy">
              <div className="panel-kicker">
                ANALYSING {destination.toUpperCase()}
              </div>
              <h3>{loadingSteps[loadingStep]}</h3>
              <p>
                Combining targeted search lanes, source extraction and forecast
                data for {prettyDate(startDate)} – {prettyDate(endDate)}.
              </p>
              <div className="progress-track">
                <span />
              </div>
            </div>
            <div className="loading-timer">
              <span className="loading-indicator" /> LIVE SCAN
            </div>
          </section>
        )}

        {error && !loading && (
          <section className="error-panel result-reveal" role="alert">
            <div className="error-icon">
              <TriangleAlert size={21} />
            </div>
            <div className="error-content">
              <h3>We couldn't complete that scan.</h3>
              <p>{error}</p>
              <span>
                Try again shortly and check official advisories for urgent
                updates. A failed scan never means the destination is safe.
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setError('')}
              aria-label="Dismiss error"
            >
              <RefreshCw size={16} />
            </button>
          </section>
        )}

        {hasResult && !loading && (
          <section className="results-section" aria-live="polite">
            <div className="results-header result-reveal">
              <div>
                <div className="panel-kicker">
                  SCAN RESULTS <span className="tiny-separator">/</span>{' '}
                  {result.destination.toUpperCase()}
                </div>
                <h2>
                  {result.hasIssues
                    ? 'Signals to pay attention to.'
                    : inconclusive
                      ? 'Risk status could not be verified.'
                      : 'No issues crossed the screening threshold.'}
                </h2>
                <p className="results-subtitle">
                  {prettyDate(result.startDate)} — {prettyDate(result.endDate)}
                </p>
              </div>
              <div className="scan-meta">
                <span
                  className={`meta-check ${inconclusive || limited ? 'meta-check-warning' : ''}`}
                >
                  {inconclusive || limited ? (
                    <TriangleAlert size={14} />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}{' '}
                  {inconclusive
                    ? 'INCONCLUSIVE COVERAGE'
                    : limited
                      ? 'LIMITED COVERAGE'
                      : 'SCAN COMPLETE'}
                </span>
                <span>
                  {result.searchResultsReturned ?? result.sourcesChecked} search
                  results <i /> {result.sourcesChecked} selected sources <i />{' '}
                  {fetchedWeb} pages opened <i />{' '}
                  {formatDuration(result.durationMs)}
                </span>
              </div>
            </div>

            <div
              className={`coverage-strip result-reveal ${inconclusive ? 'coverage-inconclusive' : limited ? 'coverage-limited' : 'coverage-good'}`}
            >
              <div className="coverage-status-icon">
                {inconclusive || limited ? (
                  <TriangleAlert size={18} />
                ) : (
                  <CheckCircle2 size={18} />
                )}
              </div>
              <div className="coverage-copy">
                <strong>
                  {inconclusive
                    ? 'Evidence is insufficient for an all-clear.'
                    : limited
                      ? 'Some evidence is missing or weak.'
                      : 'Source collection completed with reasonable coverage.'}
                </strong>
                <span>
                  {result.relevantSources ?? 0} relevant web sources ·{' '}
                  {result.sourceHealth?.searchGroupsSucceeded ?? 0}/
                  {result.sourceHealth?.searchGroupsTried ?? 8} search lanes
                  succeeded · {result.weatherSourcesChecked ?? 0} weather API
                  feeds
                </span>
              </div>
              {result.analysisMode === 'llm' ? (
                <span className="coverage-mode">
                  <Sparkles size={13} /> {friendlyModelName(result.model)}
                </span>
              ) : (
                <span className="coverage-mode warning-mode">
                  <TriangleAlert size={13} /> Basic review
                </span>
              )}
            </div>

            {result.hasIssues && (
              <div
                className={`risk-summary result-reveal ${severityClass(result.riskLevel)}`}
              >
                <div className="risk-score-block">
                  <span className="score-label">TRIP RISK SIGNAL</span>
                  <div className="score-line">
                    <strong>{result.riskScore}</strong>
                    <span>/ 100</span>
                  </div>
                  <span
                    className={`risk-level ${severityClass(result.riskLevel)}`}
                  >
                    {result.riskLevel} · {result.issueCount}{' '}
                    {result.issueCount === 1 ? 'issue' : 'issues'}
                  </span>
                </div>
                <div className="risk-divider" />
                <div className="briefing-block">
                  <div className="briefing-label">
                    <Sparkles size={15} /> TRAVEL BRIEFING{' '}
                    {rulesMode && <span className="mode-tag">RULE-BASED</span>}
                  </div>
                  <p>{result.briefing}</p>
                </div>
                <div className="risk-decoration">
                  <div className="risk-ring ring-one" />
                  <div className="risk-ring ring-two" />
                  <div className="risk-ring ring-three" />
                  <ArrowDownRight size={18} />
                </div>
              </div>
            )}

            {!result.hasIssues && (
              <div
                className={`clear-state result-reveal ${inconclusive ? 'clear-state-warning' : ''}`}
              >
                <div className="clear-icon">
                  {inconclusive || limited ? (
                    <TriangleAlert size={22} />
                  ) : (
                    <CheckCircle2 size={22} />
                  )}
                </div>
                <div>
                  <h3>
                    {inconclusive
                      ? 'The scan cannot reliably assess every travel risk yet.'
                      : limited
                        ? 'No high-confidence issue found, but coverage is limited.'
                        : 'No issues passed the current screening threshold.'}
                  </h3>
                  <p>
                    {result.briefing ||
                      'Check the reviewed sources and official advisories again close to departure.'}{' '}
                    This is not a guarantee of safety.
                  </p>
                  <span className="clear-source-count">
                    {fetchedWeb} pages fetched · {result.relevantSources ?? 0}{' '}
                    relevant web sources · {result.sourcesChecked} selected
                    sources
                  </span>
                </div>
              </div>
            )}

            {rulesMode && (
              <p className="rules-note result-reveal">
                <TriangleAlert size={14} /> Gemini and Groq AI review were
                unavailable for this scan. Any rule-based issues are potential
                leads, not AI-verified findings.{' '}
                {result.sourceHealth?.llmError || ''}
              </p>
            )}

            {result.hasIssues && (
              <div className="issues-heading result-reveal">
                <div>
                  <span className="panel-kicker">
                    WHAT MAY AFFECT YOUR TRIP
                  </span>
                  <h3>
                    {result.issueCount}{' '}
                    {result.issueCount === 1 ? 'signal' : 'signals'} found
                  </h3>
                </div>
                <span className="sort-label">
                  HIGHEST SIGNAL FIRST <ChevronDown size={14} />
                </span>
              </div>
            )}
            {result.hasIssues && (
              <div className="issues-list">
                {result.issues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    sources={issue.sourceIds
                      .map((id) => resultSources.get(id))
                      .filter(Boolean)}
                  />
                ))}
              </div>
            )}

            {weather && <WeatherPanel weather={weather} />}

            <section className="evidence-section result-reveal">
              <div className="evidence-heading">
                <div>
                  <span className="panel-kicker">TRANSPARENCY</span>
                  <h3>Sources & collection coverage</h3>
                  <p>
                    See what TraceRisk searched and which pages it actually
                    opened.
                  </p>
                </div>
                <div className="evidence-icon">
                  <FileSearch size={20} />
                </div>
              </div>
              <details
                className="source-details"
                open={inconclusive || limited}
              >
                <summary>
                  <span>
                    <Search size={15} /> Search lanes
                  </span>
                  <strong>
                    {laneStats.filter((lane) => lane.succeeded).length}/
                    {laneStats.length} successful
                  </strong>
                </summary>
                <div className="lane-grid">
                  {laneStats.map((lane) => {
                    const Icon = laneIcons[lane.id] || Search;
                    return (
                      <div
                        className={`lane-card ${lane.succeeded ? '' : 'lane-failed'}`}
                        key={lane.id}
                      >
                        <div className="lane-icon">
                          <Icon size={16} />
                        </div>
                        <div className="lane-copy">
                          <strong>{lane.label || lane.id}</strong>
                          <span>
                            {lane.succeeded
                              ? `${lane.resultCount} results · ${lane.selectedCount} selected${lane.searchMode === 'broad-fallback' ? ' · broader retry used' : ''}`
                              : lane.error || 'Search failed'}
                          </span>
                        </div>
                        <span
                          className={`lane-state ${lane.succeeded ? 'lane-state-ok' : 'lane-state-bad'}`}
                        >
                          {lane.succeeded ? 'OK' : 'ERR'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
              <details
                className="source-details"
                open={inconclusive || limited}
              >
                <summary>
                  <span>
                    <ExternalLink size={15} /> Retrieved sources
                  </span>
                  <strong>{(result.sources || []).length} links</strong>
                </summary>
                <div className="source-list">
                  {(result.sources || []).map((source) => (
                    <a
                      key={source.id}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="source-list-item"
                    >
                      <div className="source-list-kind">
                        <span>
                          {source.group === 'weather-api' ? (
                            <CloudRain size={15} />
                          ) : (
                            <FileSearch size={15} />
                          )}
                        </span>
                        <small>{source.id}</small>
                      </div>
                      <div className="source-list-main">
                        <strong>
                          {source.title || source.domain || source.id}
                        </strong>
                        <span>
                          {source.domain} ·{' '}
                          {source.publishedAt
                            ? `date: ${source.publishedAt}`
                            : 'date not provided'}{' '}
                          · {source.group || 'web'}
                        </span>
                        {source.preview && (
                          <p className="source-list-preview">
                            {source.preview}
                          </p>
                        )}
                      </div>
                      <div
                        className={`source-fetch-tag ${source.fetched ? 'is-fetched' : 'not-fetched'}`}
                      >
                        {source.group === 'weather-api'
                          ? 'API DATA'
                          : source.fetched
                            ? 'OPENED'
                            : 'SNIPPET'}
                      </div>
                      <ExternalLink size={13} className="source-open-icon" />
                    </a>
                  ))}
                  {!(result.sources || []).length && (
                    <p className="empty-source-note">
                      No source links were returned.
                    </p>
                  )}
                </div>
              </details>
            </section>

            <footer className="results-footer">
              <span>
                <Clock3 size={13} /> Checked{' '}
                {result.checkedAt
                  ? new Date(result.checkedAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'just now'}
              </span>
              <span>
                {result.searchMs != null
                  ? `Search ${formatDuration(result.searchMs)} · Sources ${formatDuration(result.fetchMs)} · Review ${formatDuration(result.assessmentMs)}`
                  : ''}
                <i />{' '}
                {result.analysisMode === 'llm'
                  ? `AI review · ${friendlyModelName(result.model)}`
                  : 'Basic rules review'}
              </span>
              <p>{result.disclaimer}</p>
            </footer>
            <div className="scan-again">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setResult(null);
                  setError('');
                  document.getElementById('destination')?.focus();
                }}
              >
                <RefreshCw size={14} /> New scan
              </button>
            </div>
          </section>
        )}

        {!loading && !hasResult && !error && (
          <section className="quiet-footer">
            <div className="quiet-rule" />
            <span>BUILT FOR BETTER TRAVEL DECISIONS</span>
            <p>Source-led signals. Clear context. No false reassurance.</p>
            <div className="starter-lanes">
              {[
                'Traffic & roads',
                'Transit',
                'Civil unrest',
                'Official advisories',
                'Health',
                'Crime',
                'Infrastructure',
                'Regional news',
              ].map((lane) => (
                <span key={lane}>{lane}</span>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>© 2026 TRACERISK</span>
        <span>
          PROTOTYPE <i /> VERIFY BEFORE YOU TRAVEL
        </span>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo <ExternalLink size={12} />
        </a>
      </footer>
    </div>
  );
}
