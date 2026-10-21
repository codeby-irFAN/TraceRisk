export async function settleWithConcurrency(items, concurrency, task) {
  const outcomes = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          outcomes[index] = {
            status: 'fulfilled',
            value: await task(items[index]),
          };
        } catch (reason) {
          outcomes[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return outcomes;
}
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
