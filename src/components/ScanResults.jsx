import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Printer,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { buildBriefing } from '../planning.js';
import {
  prettyDate,
  formatDuration,
  friendlyModelName,
  severityClass,
} from '../utils.js';
import IssueCard from './IssueCard.jsx';
import WeatherPanel from './WeatherPanel.jsx';
import EvidencePanel from './EvidencePanel.jsx';
import TripContext from './TripContext.jsx';

const categories = [
  ['all', 'All signals'],
  ['Environmental', 'Weather'],
  ['Infrastructure / Transit', 'Transport'],
  ['Geopolitical & Civil', 'Public order'],
  ['Health & Medical', 'Health'],
  ['Micro-Crime Trends', 'Crime'],
];

export default function ScanResults({ result, onNewScan }) {
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('score');
  const issues = result.issues || [];
  const uncertain = result.coverageStatus !== 'adequate';
  const inconclusive = result.coverageStatus === 'inconclusive';
  const sources = useMemo(
    () => new Map((result.sources || []).map((source) => [source.id, source])),
    [result],
  );
  const filtered = useMemo(
    () =>
      issues
        .filter((issue) => category === 'all' || issue.dimension === category)
        .sort((a, b) =>
          sort === 'score'
            ? b.score - a.score
            : (b.confidence || 0) - (a.confidence || 0),
        ),
    [issues, category, sort],
  );

  useEffect(() => {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    document.getElementById('briefing')?.scrollIntoView({
      behavior: reduced ? 'instant' : 'smooth',
      block: 'start',
    });
    document.getElementById('briefing-title')?.focus({ preventScroll: true });
  }, [result]);

  function downloadBriefing() {
    const url = URL.createObjectURL(
      new Blob([buildBriefing(result)], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `tracerisk-${
      result.destination
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'trip'
    }-${result.startDate}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section
      id="briefing"
      className="results-section"
      aria-labelledby="briefing-title"
    >
      <header className="results-header">
        <div>
          <span className="panel-kicker">YOUR TRAVEL BRIEFING</span>
          <h2 id="briefing-title" tabIndex={-1}>
            {result.destination}
          </h2>
          <p>
            {prettyDate(result.startDate)} — {prettyDate(result.endDate)}
          </p>
        </div>
        <div className="result-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={downloadBriefing}
          >
            <Download size={15} /> Download briefing
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Print briefing"
            onClick={() => window.print()}
          >
            <Printer size={17} />
          </button>
        </div>
      </header>
      <p className="print-only">
        This printed view reflects the selected signal and source filters.
        Download the briefing for all findings and source links.
      </p>
      <div
        className={`coverage-strip coverage-${result.coverageStatus || 'inconclusive'}`}
      >
        {uncertain ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}
        <div>
          <strong>
            {inconclusive
              ? 'Evidence is insufficient for an all-clear.'
              : uncertain
                ? 'Some evidence is missing or weak.'
                : 'Sources collected. Keep the context in mind.'}
          </strong>
          <p>
            {result.relevantSources ?? 0} relevant web sources ·{' '}
            {result.pagesFetched ?? 0} full pages opened ·{' '}
            {result.weatherSourcesChecked ?? 0} weather feeds
          </p>
        </div>
        <span className="coverage-mode">
          {result.analysisMode === 'llm'
            ? friendlyModelName(result.model)
            : 'Rules-based review'}
        </span>
      </div>
      <div
        className={`risk-summary ${result.hasIssues ? severityClass(result.riskLevel) : 'no-signals'}`}
      >
        <div className="risk-score-block">
          {result.hasIssues ? (
            <>
              <span className="score-label">TRIP RISK SIGNAL</span>
              <div className="score-line">
                <strong>{result.riskScore}</strong>
                <span>/ 100</span>
              </div>
              <span className="risk-level">{result.riskLevel}</span>
            </>
          ) : (
            <>
              <ShieldAlert size={30} strokeWidth={1.3} />
              <span className="risk-level">
                {result.resultStatus === 'unavailable'
                  ? 'Live sources unavailable'
                  : inconclusive
                    ? 'Coverage incomplete'
                    : 'Trip information collected'}
              </span>
            </>
          )}
        </div>
        <div className="briefing-block">
          <span className="panel-kicker">THE BIG PICTURE</span>
          <h3>
            {result.hasIssues
              ? 'Signals to pay attention to.'
              : 'Your briefing and next checks.'}
          </h3>
          <p>{result.briefing}</p>
          {!result.hasIssues && (
            <p className="no-guarantee">This is not a guarantee of safety.</p>
          )}
        </div>
      </div>
      {result.analysisMode === 'rules' && (
        <p className="rules-note">
          <TriangleAlert size={15} /> Sources were checked automatically without
          AI review. Confirm the current status of cited reports before travel.
        </p>
      )}
      {issues.length > 0 && (
        <section className="signals-section" aria-labelledby="signals-title">
          <div className="section-heading">
            <div>
              <span className="panel-kicker">WHAT MAY AFFECT YOUR TRIP</span>
              <h2 id="signals-title">A closer look.</h2>
            </div>
            <label className="select-control">
              <span className="sr-only">Sort signals</span>
              <select
                aria-label="Sort signals"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="score">Highest signal first</option>
                <option value="confidence">Highest confidence first</option>
              </select>
            </label>
          </div>
          <div className="filter-chips" aria-label="Filter signals">
            {categories.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={category === id}
                onClick={() => setCategory(id)}
              >
                {label}
                <span>
                  {id === 'all'
                    ? issues.length
                    : issues.filter((issue) => issue.dimension === id).length}
                </span>
              </button>
            ))}
          </div>
          <p className="filter-count" role="status">
            Showing {filtered.length} of {issues.length} signals
          </p>
          <div className="issues-list">
            {filtered.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                checkedAt={result.checkedAt}
                sources={(issue.sourceIds || [])
                  .map((id) => sources.get(id))
                  .filter(Boolean)}
              />
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-filter">
              <FileText size={24} />
              <p>
                No signals in this category. The overall scan coverage still
                applies.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => setCategory('all')}
              >
                Show all signals
              </button>
            </div>
          )}
        </section>
      )}
      {result.weather && <WeatherPanel weather={result.weather} />}
      <TripContext result={result} />
      <EvidencePanel result={result} />
      <footer className="results-footer">
        <span>
          <Clock3 size={14} /> Checked{' '}
          {result.checkedAt
            ? new Date(result.checkedAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : 'just now'}{' '}
          · {formatDuration(result.durationMs)}
        </span>
        <p>
          {result.disclaimer ||
            'TraceRisk is an experimental travel-awareness tool, not an official safety rating. Confirm important conditions with local authorities.'}
        </p>
        <button type="button" className="text-button" onClick={onNewScan}>
          Plan another journey <ArrowUpRight size={15} />
        </button>
      </footer>
    </section>
  );
}
