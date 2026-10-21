import { useMemo, useState } from 'react';
import { CloudRain, ExternalLink, FileSearch, Search } from 'lucide-react';
import SourceBadges from './SourceBadges.jsx';

export default function EvidencePanel({ result }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const sources = result.sources || [];
  const lanes =
    result.searchLaneStats || result.sourceHealth?.searchLanes || [];
  const filtered = useMemo(
    () =>
      sources.filter((source) => {
        const matches = `${source.title || ''} ${source.domain || ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
        return (
          matches &&
          (kind === 'all' ||
            (kind === 'official' && source.trust === 'Official government') ||
            (kind === 'snippets' &&
              !source.fetched &&
              source.group !== 'weather-api') ||
            (kind === 'weather' && source.group === 'weather-api'))
        );
      }),
    [sources, query, kind],
  );
  return (
    <section
      id="evidence"
      className="evidence-section result-reveal"
      aria-labelledby="evidence-title"
    >
      <div className="section-heading">
        <div>
          <span className="panel-kicker">FOLLOW THE EVIDENCE</span>
          <h2 id="evidence-title">Every source, out in the open.</h2>
          <p>
            See what was collected, what was opened, and where coverage is
            missing.
          </p>
        </div>
        <FileSearch size={25} strokeWidth={1.4} />
      </div>
      <details
        className="source-details"
        open={result.coverageStatus !== 'adequate'}
      >
        <summary>
          <span>
            <ExternalLink size={16} /> Reviewed sources
          </span>
          <strong>{sources.length} links</strong>
        </summary>
        <div className="source-controls">
          <label className="source-search">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search reviewed sources"
              placeholder="Search title or website"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="select-control">
            <span className="sr-only">Source type</span>
            <select
              aria-label="Source type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">All sources</option>
              <option value="official">Government sources</option>
              <option value="snippets">Snippet only</option>
              <option value="weather">Weather models</option>
            </select>
          </label>
        </div>
        <p className="filter-count" role="status">
          Showing {filtered.length} of {sources.length} sources
        </p>
        <div className="source-list">
          {filtered.map((source) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="source-list-item"
            >
              <span className="source-list-kind">
                {source.group === 'weather-api' ? (
                  <CloudRain size={17} />
                ) : (
                  <FileSearch size={17} />
                )}
                <small>{source.id}</small>
              </span>
              <div className="source-list-main">
                <strong>{source.title || source.domain || source.id}</strong>
                <span className="source-domain">
                  {source.domain} · {source.group || 'web'}
                </span>
                <SourceBadges source={source} checkedAt={result.checkedAt} />
                {source.preview && (
                  <p className="source-list-preview">{source.preview}</p>
                )}
              </div>
              <ExternalLink size={15} className="source-open-icon" />
            </a>
          ))}
          {!filtered.length && (
            <div className="empty-filter">
              <Search size={22} />
              <p>
                {sources.length
                  ? 'No sources match these filters.'
                  : 'No source links were returned.'}
              </p>
              {sources.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setKind('all');
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>
      </details>
      <details className="source-details">
        <summary>
          <span>
            <Search size={16} /> Search coverage
          </span>
          <strong>
            {lanes.filter((lane) => lane.succeeded).length}/{lanes.length} lanes
            responded
          </strong>
        </summary>
        <div className="lane-grid">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className={`lane-card ${lane.succeeded ? '' : 'lane-failed'}`}
            >
              <span
                className={`lane-indicator ${lane.succeeded && lane.resultCount > 0 ? 'has-results' : ''}`}
              />
              <div>
                <strong>{lane.label || lane.id}</strong>
                <span>
                  {lane.succeeded
                    ? `${lane.resultCount} results · ${lane.selectedCount} selected${lane.searchMode === 'broad-fallback' ? ' · broader retry' : ''}`
                    : lane.error || 'Collection failed'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
