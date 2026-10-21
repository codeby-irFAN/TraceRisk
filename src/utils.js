export function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function plusDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function prettyDate(dateString) {
  if (!dateString) return '';
  return new Date(`${dateString}T12:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

export function severityClass(value) {
  return String(value || 'low')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-');
}

export function friendlyModelName(model) {
  if (!model || model === 'rules fallback') return 'Basic rules review';
  if (
    String(model).startsWith('Gemini · ') ||
    String(model).startsWith('Groq · ')
  )
    return model;
  if (model === 'openai/gpt-oss-20b') return 'Groq · GPT-OSS 20B';
  if (model === 'openai/gpt-oss-120b') return 'Groq · GPT-OSS 120B';
  if (String(model).startsWith('gemini-')) return `Gemini · ${model}`;
  return `AI · ${model}`;
}

export function getSourceBadges(source, checkedAt) {
  const model = source.group === 'weather-api';
  const badges = [];
  if (model)
    badges.push({
      kind: 'model',
      label: 'Forecast model',
      description: 'Model output, not an official weather warning.',
    });
  else if (source.trust === 'Official government')
    badges.push({
      kind: 'official',
      label: 'Government source',
      description:
        'Government website. Check the advisory date and whether it applies to your trip.',
    });
  else if (source.trust === 'News outlet')
    badges.push({
      kind: 'news',
      label: 'News outlet',
      description:
        'A news report; confirm important details with the relevant authority.',
    });
  badges.push(
    model
      ? {
          kind: 'opened',
          label: 'API data',
          description: 'Data retrieved directly from the forecast provider.',
        }
      : source.fetched
        ? {
            kind: 'opened',
            label: 'Page opened',
            description:
              'The full page was retrieved. This does not establish accuracy or date relevance.',
          }
        : {
            kind: 'snippet',
            label: 'Snippet only',
            description:
              'The full page could not be retrieved; only the search excerpt was reviewed.',
          },
  );
  const date = source.publishedAt ? new Date(source.publishedAt) : null;
  if (!date || Number.isNaN(date.getTime())) {
    badges.push({
      kind: 'unknown',
      label: model ? 'Retrieval date unknown' : 'Publication date unknown',
      description:
        'Date relevance could not be established from the supplied metadata.',
    });
  } else {
    const label = date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    badges.push({
      kind: 'date',
      label: `${model ? 'Retrieved' : 'Published'} ${label}`,
      description: model
        ? 'When forecast data was collected.'
        : 'Publication date supplied by the source provider.',
    });
    const ageDays =
      (new Date(checkedAt || Date.now()).getTime() - date.getTime()) /
      86_400_000;
    if (!model && ageDays > 30)
      badges.push({
        kind: 'old',
        label: 'Older report',
        description:
          'Published more than 30 days before this scan. Verify whether the event or advisory is still active.',
      });
    if (!model && ageDays < -1)
      badges.push({
        kind: 'unknown',
        label: 'Future date — verify',
        description: 'The supplied publication date is after the scan date.',
      });
  }
  return badges;
}

export function requestError(response, payload, fallback) {
  const message = payload?.error || fallback;
  const seconds = Number(response.headers.get('retry-after'));
  return response.status === 429 && Number.isFinite(seconds) && seconds > 0
    ? `${message} Try again in ${Math.ceil(seconds)} seconds.`
    : message;
}
