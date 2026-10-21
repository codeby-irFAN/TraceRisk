import {
  CarFront,
  CloudRain,
  ExternalLink,
  HeartPulse,
  MapPin,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { severityClass } from '../utils.js';
import SourceBadges from './SourceBadges.jsx';

const dimensionIcons = {
  'Geopolitical & Civil': ShieldAlert,
  Environmental: CloudRain,
  'Health & Medical': HeartPulse,
  'Infrastructure / Transit': CarFront,
  'Micro-Crime Trends': ShieldCheck,
};

export default function IssueCard({ issue, sources, checkedAt }) {
  const Icon = dimensionIcons[issue.dimension] || ShieldAlert;
  return (
    <article className={`issue-card severity-${severityClass(issue.severity)}`}>
      <div className="issue-icon">
        <Icon size={19} />
      </div>
      <div className="issue-main">
        <div className="issue-label-row">
          <span className="dimension-label">{issue.dimension}</span>
          <span className={`severity-tag ${severityClass(issue.severity)}`}>
            <span />
            {issue.severity}
          </span>
          <span className="confidence-tag">
            {Math.round((issue.confidence || 0) * 100)}% confidence
          </span>
        </div>
        <h3>{issue.title}</h3>
        <p className="issue-summary">{issue.summary}</p>
        {issue.area && (
          <div className="issue-area">
            <MapPin size={12} /> {issue.area}
          </div>
        )}
        {issue.travelerImpact && (
          <div className="traveler-impact">
            <span>TRAVEL IMPACT</span>
            <p>{issue.travelerImpact}</p>
          </div>
        )}
        {issue.evidence && (
          <blockquote className="evidence-quote">“{issue.evidence}”</blockquote>
        )}
        <div className="source-row">
          {sources.map((source) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="source-link"
            >
              <span className="source-favicon">↗</span>
              <span>{source.domain || source.title || source.id}</span>
              <SourceBadges source={source} checkedAt={checkedAt} />
              <ExternalLink size={11} />
            </a>
          ))}
          {!sources.length && (
            <span className="source-link source-missing">
              No validated source link returned
            </span>
          )}
        </div>
      </div>
      <div className="issue-score">
        <strong>{issue.score}</strong>
        <span>/100</span>
        <small>signal</small>
      </div>
    </article>
  );
}
