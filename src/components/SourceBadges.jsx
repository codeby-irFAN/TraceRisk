import { getSourceBadges } from '../utils.js';

export default function SourceBadges({ source, checkedAt }) {
  return (
    <span className="source-badges" aria-label="Source quality">
      {getSourceBadges(source, checkedAt).map((badge) => (
        <span
          key={badge.label}
          className={`source-badge source-badge-${badge.kind}`}
          title={badge.description}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}
