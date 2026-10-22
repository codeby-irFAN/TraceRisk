import logo from '../../graphics/logo.png';
import { useState } from 'react';
import { api, place, when } from './api';
import RouteMap from './RouteMap';
export function Sources({ sources = [] }) {
  return (
    <div className="source-links">
      {sources.map((s, i) => (
        <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noreferrer">
          {s.label || `↗ ${i + 1}`} {s.title || 'Original source'}
        </a>
      ))}
    </div>
  );
}
export function Report({ report, detailed = false }) {
  const result = report.result;
  return (
    <section className="trip-card report">
      <div className="section-head">
        <div>
          <p className="eyebrow">
            {report.kind === 'checkpoint'
              ? 'ALONG THE WAY'
              : report.kind === 'origin'
                ? 'ORIGIN'
                : 'YOUR STOP'}
          </p>
          <h3>{report.label}</h3>
          <small>
            {report.startDate} → {report.endDate}
          </small>
        </div>
        <span className="pill">{result.issues?.length || 0} updates</span>
      </div>
      <h4>{result.decision?.title}</h4>
      {result.placeContext && (
        <p className="muted">{result.placeContext.note}</p>
      )}
      <p>{result.decision?.detail}</p>
      <div className="coverage-grid">
        {result.decision?.checks?.map((c) => (
          <div key={c.id}>
            <strong>{c.label}</strong>
            <span className={`status-${c.status}`}>
              {{
                checked: 'Available',
                searched: 'Checked',
                partial: 'Some information missing',
                unknown: 'Check before leaving',
              }[c.status] || c.status}
            </span>
            <small>{c.detail}</small>
          </div>
        ))}
      </div>
      {result.issues?.map((issue, i) => (
        <article className="finding" key={issue.id || i}>
          <div className="section-head">
            <h4>{issue.title}</h4>
            <span className="pill">
              {issue.verification?.label || issue.dimension}
            </span>
          </div>
          <p>{issue.summary || issue.travelerImpact}</p>
          <p className="muted">
            Affected area: {issue.area || report.label} · Applies to check:{' '}
            {report.startDate}–{report.endDate}
          </p>
          <ul>
            {issue.personalImpact?.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {detailed && (
            <>
              <blockquote>{issue.evidence}</blockquote>
              <dl>
                <dt>Event date</dt>
                <dd>
                  {issue.verification?.eventDateNote ||
                    'See original report; exact date unconfirmed.'}
                </dd>
                <dt>Evidence confidence</dt>
                <dd>
                  {issue.verification?.confidence || 'Review source'} —{' '}
                  {issue.verification?.explanation}
                </dd>
                <dt>Last verified</dt>
                <dd>
                  {when(issue.verification?.checkedAt || result.checkedAt)}
                </dd>
              </dl>
              <Sources
                sources={
                  issue.verification?.supporting ||
                  result.sources?.filter((s) => issue.sourceIds?.includes(s.id))
                }
              />
              {issue.verification?.conflicts?.length > 0 && (
                <div className="notice">
                  <strong>Conflicting information</strong>
                  {issue.verification.conflicts.map((s) => (
                    <div key={s.id}>
                      <p>{s.quote}</p>
                      <Sources sources={[s]} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </article>
      ))}
      {result.weather?.dailyForecast?.length > 0 && (
        <details>
          <summary>Daily weather forecast</summary>
          <div className="forecast-list">
            {result.weather.dailyForecast.map((d, i) => (
              <div key={i}>
                <strong>{d.date}</strong> · {d.condition || 'Forecast'}
                <br />
                {d.minC ?? '—'}–{d.maxC ?? '—'}°C · Rain{' '}
                {d.precipitationMm ?? '—'} mm (
                {d.precipitationProbabilityPct ?? '—'}%) · Wind{' '}
                {d.maxWindKmh ?? '—'} km/h · Gusts {d.maxGustKmh ?? '—'} km/h
              </div>
            ))}
          </div>
        </details>
      )}
      <details open={!result.issues?.length}>
        <summary>Practical checks before departure</summary>
        {result.nextSteps?.map((s, i) => (
          <p key={i}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>{' '}
            — {s.detail}
          </p>
        ))}
      </details>
      {detailed && result.retrievalProviders?.length > 0 && (
        <details>
          <summary>Where we looked</summary>
          {[...new Set(result.retrievalProviders.map((p) => p.provider))].map(
            (name) => {
              const checks = result.retrievalProviders.filter(
                  (p) => p.provider === name,
                ),
                done = checks.filter((p) => p.status === 'checked').length;
              return (
                <p key={name}>
                  <strong>{name}</strong> ·{' '}
                  {done === checks.length
                    ? 'Checked'
                    : done
                      ? 'Some searches were unavailable'
                      : 'Could not reach this service'}
                </p>
              );
            },
          )}
          <p className="muted">
            We keep the reports and forecasts that load successfully. A failed
            service does not mean there are no travel issues.
          </p>
        </details>
      )}
      {detailed && (
        <details>
          <summary>
            All retrieved sources and leads ({result.sources?.length || 0})
          </summary>
          <Sources sources={result.sources} />
          {result.leads?.map((s, i) => (
            <p key={i}>{s.title || s.url} — lead requiring verification</p>
          ))}
        </details>
      )}
    </section>
  );
}
export function Briefing({ data }) {
  return (
    <article
      className="briefing"
      style={{ '--brief-color': data.agency?.color || '#28594a' }}
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">
            {data.agency?.name || 'TRACERISK'} · TRIP BRIEFING
          </p>
          <h1>{data.title}</h1>
          <p>{data.client}</p>
          <p>{data.agency?.contact}</p>
        </div>
        <img src={logo} alt="TraceRisk" width="70" />
      </div>
      <p>
        Collected {when(data.latest?.checkedAt)}.{' '}
        {data.expiresAt && `Link expires ${when(data.expiresAt)}.`}
      </p>
      <p className="notice">
        Saved travel updates and departure checks. Conditions can change; check
        again before you leave.
      </p>
      <ol className="itinerary-line">
        {data.stops.map((s) => (
          <li key={s.id}>
            <strong>{place(s.location)}</strong> · {s.startDate} → {s.endDate}
          </li>
        ))}
      </ol>
      {data.latest?.reports.map((r) => (
        <Report key={r.key} report={r} detailed />
      ))}
      <button className="primary no-print" onClick={() => window.print()}>
        Print / save as PDF
      </button>
    </article>
  );
}
export default function TripDetails({ trip, act, refresh, onEdit, agency }) {
  const [tab, setTab] = useState('Overview'),
    [offset, setOffset] = useState(1),
    [route, setRoute] = useState(0),
    [question, setQuestion] = useState('What should I check before leaving?'),
    [answer, setAnswer] = useState(null),
    [share, setShare] = useState(null),
    [includeClient, setIncludeClient] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const latest = trip.latest;
  const [scanMode, setScanMode] = useState('quick');
  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="trip-detail">
      <div className="section-head detail-heading">
        <div>
          <p className="eyebrow">
            {trip.client || 'YOUR ITINERARY'} ·{' '}
            {trip.preferences.mode.toUpperCase()}
          </p>
          <h1>{trip.title}</h1>
          <p className="muted">
            {trip.stops.length} stop{trip.stops.length === 1 ? '' : 's'} ·{' '}
            {trip.stops[0].startDate} → {trip.stops.at(-1).endDate}
          </p>
        </div>
        <div className="inline">
          <button disabled={trip.checking} onClick={onEdit}>
            Edit trip
          </button>
          <label className="scan-mode-label">
            Check type
            <select
              aria-label="Check type"
              value={scanMode}
              disabled={trip.checking}
              onChange={(e) => setScanMode(e.target.value)}
            >
              <option value="quick">Quick · around 20 seconds per place</option>
              <option value="thorough">
                Thorough · more sources, up to 8 minutes
              </option>
            </select>
          </label>
          <button
            className="primary"
            disabled={trip.checking}
            onClick={() => act('check', { scanMode })}
          >
            {trip.checking
              ? 'Checking…'
              : latest
                ? 'Check again'
                : 'Check trip'}
          </button>
        </div>
      </div>
      {trip.checking && (
        <div className="notice" role="status">
          <strong>{trip.progress?.phase || 'Collecting travel updates'}</strong>
          <p>
            {trip.progress?.scanMode === 'thorough'
              ? 'Thorough check: reading more sources. Large itineraries can take up to 8 minutes.'
              : 'Checking your stops and nearby route areas. Large itineraries can take up to 2 minutes.'}
          </p>
          {trip.progress?.total > 0 && (
            <p>
              {trip.progress.completed || 0} of {trip.progress.total} places
              reviewed
            </p>
          )}{' '}
          <button onClick={() => act('cancel')}>Cancel check</button>
        </div>
      )}
      {trip.lastError && (
        <p className="error" role="alert">
          {trip.lastError}
        </p>
      )}
      <div className="watch-strip">
        <span>
          ● Trip Watch{' '}
          {trip.watchEnded ? 'finished' : trip.watch.enabled ? 'on' : 'paused'}
        </span>
        <span>
          Last check: {when(latest?.checkedAt)}
          {latest?.scanMode &&
            ` · ${latest.scanMode === 'thorough' ? 'Thorough' : 'Quick'}`}
        </span>
        <span>
          Next check:{' '}
          {trip.watchEnded
            ? 'Trip dates have ended'
            : trip.watch.enabled
              ? when(trip.nextCheckAt)
              : 'paused'}
        </span>
        <button
          disabled={trip.checking}
          onClick={() =>
            run(async () => {
              await api(
                `/trips/${trip.id}/watch`,
                { ...trip.watch, enabled: !trip.watch.enabled },
                'PATCH',
              );
              await refresh();
            })
          }
        >
          {trip.watch.enabled ? 'Pause' : 'Resume'}
        </button>
      </div>
      <div className="trip-tabs" role="tablist" aria-label="Trip views">
        {[
          'Overview',
          'Route map',
          'Evidence',
          'What changed',
          'Compare',
          'Assistant',
          'Share',
        ].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === 'Overview' && (
        <>
          <div className="metric-grid">
            <div className="trip-card">
              <span>TRAVEL UPDATES</span>
              <strong>{latest?.issueCount ?? '—'}</strong>
              <small>{latest?.highSignals || 0} need closer attention</small>
            </div>
            <div className="trip-card">
              <span>STOPS REVIEWED</span>
              <strong>
                {latest
                  ? `${latest.reportsChecked}/${latest.reportsTotal}`
                  : '—'}
              </strong>
              <small>Your stops and nearby route areas</small>
            </div>
            <div className="trip-card">
              <span>TRAVEL PROFILE</span>
              <strong className="metric-text">{trip.preferences.mode}</strong>
              <small>
                {[
                  ['children', 'Children'],
                  ['limitedMobility', 'Limited mobility'],
                  ['respiratory', 'Air sensitivity'],
                ]
                  .filter(([k]) => trip.preferences[k])
                  .map(([, l]) => l)
                  .join(' · ') || 'Standard precautions'}
              </small>
            </div>
          </div>
          <section className="trip-card">
            <h3>Your journey, stop by stop</h3>
            <ol className="itinerary-line">
              {trip.stops.map((s) => (
                <li key={s.id}>
                  <strong>{place(s.location)}</strong>
                  <span>
                    {s.startDate} → {s.endDate}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {latest ? (
            latest.reports.map((r) => <Report key={r.key} report={r} />)
          ) : (
            <div className="empty-state">
              <h2>Ready when you are.</h2>
              <p>
                Check your trip to collect dated reports, forecasts and
                practical departure checks for every stop.
              </p>
              <button
                className="primary"
                disabled={trip.checking}
                onClick={() => act('check', { scanMode })}
              >
                Start first check
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'Route map' && (
        <section className="trip-card">
          <h2>The journey matters too.</h2>
          <RouteMap trip={trip} />
          {latest?.route?.routes?.map((r) => (
            <p key={r.id}>
              <strong>{r.label}</strong> · {r.distanceKm} km · approximately{' '}
              {r.durationMinutes} min driving ·{' '}
              {r.roadNames?.slice(0, 5).join(', ')}
            </p>
          ))}
          <h3>Nearby travel updates</h3>
          <p className="muted">
            These reports cover the surrounding area. Open a source to see
            whether it affects your route.
          </p>
          {latest?.reports.flatMap((r) =>
            r.result.issues
              .filter((i) => !i.verification?.coordinates)
              .map((i, n) => (
                <div className="finding" key={`${r.key}-${n}`}>
                  <strong>{i.title}</strong>
                  <p>
                    {r.label} · {i.area} · {r.startDate}–{r.endDate}
                  </p>
                  <p>{i.travelerImpact || i.summary}</p>
                  <Sources
                    sources={r.result.sources.filter((s) =>
                      i.sourceIds?.includes(s.id),
                    )}
                  />
                </div>
              )),
          )}
        </section>
      )}
      {tab === 'Evidence' && (
        <>
          <p className="notice">
            Open a source to read the full report and check when it was
            published.
          </p>
          {latest?.reports.map((r) => (
            <Report key={r.key} report={r} detailed />
          ))}
          {!latest && <p>Check the trip to retrieve evidence.</p>}
        </>
      )}
      {tab === 'What changed' && (
        <section className="trip-card">
          <div className="section-head">
            <h2>Meaningful updates</h2>
            <button disabled={trip.checking} onClick={() => act('read')}>
              Mark all read
            </button>
          </div>
          <div className="two-col">
            <label>
              Check frequency
              <select
                disabled={trip.checking}
                value={trip.watch.frequencyHours}
                onChange={(e) =>
                  run(async () => {
                    await api(
                      `/trips/${trip.id}/watch`,
                      { ...trip.watch, frequencyHours: Number(e.target.value) },
                      'PATCH',
                    );
                    await refresh();
                  })
                }
              >
                {[1, 3, 6, 12, 24].map((h) => (
                  <option key={h} value={h}>
                    Every {h} hours
                  </option>
                ))}
              </select>
            </label>
            <label>
              Alert level
              <select
                disabled={trip.checking}
                value={trip.watch.alertLevel}
                onChange={(e) =>
                  run(async () => {
                    await api(
                      `/trips/${trip.id}/watch`,
                      { ...trip.watch, alertLevel: e.target.value },
                      'PATCH',
                    );
                    await refresh();
                  })
                }
              >
                <option value="all">All meaningful changes</option>
                <option value="high">Important new updates and changes</option>
              </select>
            </label>
          </div>
          <p className="muted">
            Alerts stay in this workspace. A missing report is labelled “not
            observed”; only an explicit current reopening or withdrawal report
            supports “resolved”.
          </p>
          {trip.timeline.length ? (
            trip.timeline.map((e) => (
              <article className="timeline-event" key={e.id}>
                <span className="pill">
                  {{
                    new: 'New update',
                    changed: 'Updated',
                    resolved: 'Reported resolved',
                    'not-observed': 'Not seen in the latest check',
                    coverage: 'Information updated',
                  }[e.kind] || e.kind}
                  {!e.read && ' · new'}
                </span>
                <small>{when(e.at)}</small>
                <h3>{e.title}</h3>
                <p>{e.stop}</p>
                <p>{e.detail}</p>
                <Sources sources={e.sourceLinks} />
              </article>
            ))
          ) : (
            <p>No changes recorded yet. Run a check to start the timeline.</p>
          )}
        </section>
      )}
      {tab === 'Compare' && (
        <section className="trip-card">
          <h2>Explore another departure.</h2>
          <p>
            Recheck a supported road option, a later date, or both. Your saved
            itinerary stays in place.
          </p>
          <div className="two-col">
            <label>
              Departure shift
              <select
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option value={d} key={d}>
                    {d ? `${d} day${d === 1 ? '' : 's'} later` : 'Same dates'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Road option
              <select
                value={route}
                onChange={(e) => setRoute(Number(e.target.value))}
              >
                {latest?.route?.routes?.length ? (
                  latest.route.routes.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.label}
                    </option>
                  ))
                ) : (
                  <option value={0}>Destination / stop checks only</option>
                )}
              </select>
            </label>
          </div>
          <button
            className="primary"
            disabled={!latest || trip.checking || (!offset && !route)}
            onClick={() =>
              act('compare', { dayOffset: offset, routeIndex: route })
            }
          >
            Compare this option
          </button>
          <p className="muted">
            Choose the dates that work for you, then review the weather and
            travel updates below.
          </p>
          {trip.comparison && (
            <>
              <div className="two-col">
                {[
                  ['Saved departure', latest],
                  [
                    `${trip.comparison.dayOffset} days later · option ${trip.comparison.routeIndex + 1}`,
                    trip.comparison.candidate,
                  ],
                ].map(([label, s]) => (
                  <div className="comparison" key={label}>
                    <h3>{label}</h3>
                    <p>
                      {!s.reportsChecked
                        ? 'Live updates are unavailable. Check again before leaving.'
                        : s.issueCount
                          ? `${s.issueCount} travel update${s.issueCount === 1 ? '' : 's'} to review`
                          : 'No disruptions found in the updates checked'}
                    </p>
                    <p>
                      {s.reportsChecked} of {s.reportsTotal} places have recent
                      information
                    </p>
                    {s.route.routes?.find(
                      (r) => r.id === s.route.selectedRouteId,
                    )?.durationMinutes > 0 && (
                      <p>
                        About{' '}
                        {
                          s.route.routes.find(
                            (r) => r.id === s.route.selectedRouteId,
                          ).durationMinutes
                        }{' '}
                        minutes by road
                      </p>
                    )}
                    <p>
                      {s.reports
                        ?.flatMap((r) => r.result.weather?.dailyForecast || [])
                        .slice(0, 2)
                        .map(
                          (d) =>
                            `${d.date}: ${d.condition || 'Forecast'}${d.maxC != null ? `, up to ${d.maxC}°C` : ''}`,
                        )
                        .join(' · ') ||
                        'Weather forecast is not available for these dates yet.'}
                    </p>
                    <small>Updated {when(s.checkedAt)}</small>
                  </div>
                ))}
              </div>
              <details>
                <summary>How comparisons work</summary>
                {trip.comparison.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </details>
              {trip.comparison.candidate.reports.map((r) => (
                <Report key={r.key} report={r} />
              ))}
            </>
          )}
        </section>
      )}
      {tab === 'Assistant' && (
        <section className="trip-card">
          <p className="eyebrow">GROUNDED IN YOUR TRIP</p>
          <h2>Ask about your journey.</h2>
          <div className="suggestions">
            {[
              'Which issues could affect the bus journey?',
              'What should I check before leaving tomorrow?',
              'Why did this trip’s assessment change?',
            ].map((q) => (
              <button key={q} onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () =>
                setAnswer(await api(`/trips/${trip.id}/ask`, { question })),
              );
            }}
          >
            <label>
              Your question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={500}
                required
              />
            </label>
            <button className="primary" disabled={busy || !latest}>
              {busy ? 'Checking evidence…' : 'Ask trip assistant'}
            </button>
          </form>
          {answer && (
            <div className="assistant-answer">
              <p style={{ whiteSpace: 'pre-line' }}>{answer.answer}</p>
              <Sources sources={answer.citations} />
              <h4>Keep in mind</h4>
              <ul>
                {answer.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {tab === 'Share' && (
        <section className="trip-card">
          <h2>A briefing you can take with you.</h2>
          <p>
            Share a saved copy of this briefing. Anyone with the link can read
            it for seven days. You can revoke the link at any time.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={includeClient}
              onChange={(e) => setIncludeClient(e.target.checked)}
            />
            Include the client / group name
          </label>
          <div className="inline">
            <button
              className="primary"
              disabled={!latest || busy}
              onClick={() =>
                run(async () =>
                  setShare(
                    await api(`/trips/${trip.id}/share`, { includeClient }),
                  ),
                )
              }
            >
              Create briefing link
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await api(`/trips/${trip.id}/share`, undefined, 'DELETE');
                  setShare(null);
                })
              }
            >
              Revoke link
            </button>
            <button disabled={!latest} onClick={() => window.print()}>
              Print trip
            </button>
          </div>
          {share && (
            <div className="notice">
              <a href={share.path} target="_blank" rel="noreferrer">
                {window.location.origin}
                {share.path}
              </a>
              <p>Expires {when(share.expiresAt)}</p>
              <button
                onClick={() =>
                  run(() =>
                    navigator.clipboard.writeText(
                      window.location.origin + share.path,
                    ),
                  )
                }
              >
                Copy link
              </button>
            </div>
          )}
          {latest && (
            <Briefing
              data={{
                ...trip,
                client: includeClient ? trip.client : '',
                agency: {
                  name: agency?.agencyName,
                  contact: agency?.contact,
                  color: agency?.color,
                },
              }}
            />
          )}
        </section>
      )}
      <button
        className="danger-link"
        disabled={trip.checking}
        onClick={() => {
          if (window.confirm('Delete this trip and revoke its briefing link?'))
            act('', undefined, 'DELETE');
        }}
      >
        Delete trip
      </button>
    </div>
  );
}
