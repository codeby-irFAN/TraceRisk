export function cleanText(value, maxChars = 500) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function summarizeForecastCoverage(startDate, endDate, availableDates) {
  const dayMs = 86_400_000;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const dates = [
    ...new Set(
      availableDates.filter(
        (date) => isDate(date) && date >= startDate && date <= endDate,
      ),
    ),
  ].sort();
  const tripDays = Math.round((end - start) / dayMs) + 1;
  const missing = [];
  let cursor = start;
  const dateString = (time) => new Date(time).toISOString().slice(0, 10);
  for (const date of dates) {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (time > cursor)
      missing.push({
        start: dateString(cursor),
        end: dateString(time - dayMs),
      });
    cursor = time + dayMs;
  }
  if (cursor <= end) missing.push({ start: dateString(cursor), end: endDate });
  return {
    tripDays,
    forecastDaysMatched: dates.length,
    forecastCoverage:
      dates.length === tripDays
        ? 'complete'
        : dates.length
          ? 'partial'
          : 'unavailable',
    forecastMissingDateRanges: missing,
  };
}

export function clampNumber(value, min, max, fallback) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    typeof value === 'boolean'
  )
    return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

export function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))
    return '';
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (url.username || url.password) return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    url.hostname = host;
    if (url.port && !['80', '443'].includes(url.port)) return '';
    if (
      !host.includes('.') ||
      host.includes(':') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return '';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      )
        return '';
    }
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function safeDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown source';
  }
}

export function sourceTrust(url) {
  const host = safeDomain(url);
  const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (matches('gov.in') || matches('nic.in')) return 'Official government';
  if (['x.com', 'twitter.com'].some(matches))
    return 'Social / official account check';
  const newsDomains = [
    'thehindu.com',
    'indianexpress.com',
    'hindustantimes.com',
    'ndtv.com',
    'timesofindia.indiatimes.com',
    'news18.com',
    'eastmojo.com',
    'sikkimexpress.com',
    'morungexpress.com',
    'nenow.in',
  ];
  return newsDomains.some(matches) ? 'News outlet' : 'Web source';
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function trimCache(cache, maxEntries) {
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}
