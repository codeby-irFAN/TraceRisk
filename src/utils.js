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
