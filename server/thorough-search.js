import { XMLParser } from 'fast-xml-parser';
import { searchTinyFish } from './search.js';
import { fetchJson, withRequestBudget, currentSignal } from './http.js';
import { normalizeUrl, cleanText } from './utils.js';
import { placeMatch, travelRelevance } from './evidence.js';
const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
});
export function parseNewsFeed(xml, group) {
  const parsed = parser.parse(xml),
    items = parsed?.rss?.channel?.item || [];
  return (Array.isArray(items) ? items : [items])
    .slice(0, 20)
    .map((item) => ({
      url: normalizeUrl(item.link),
      title: cleanText(item.title, 220),
      snippet: cleanText(
        String(item.description || '').replace(/<[^>]*>/g, ' '),
        1200,
      ),
      publishedAt: cleanText(item.pubDate, 60),
      group: group.id,
      searchMode: 'independent-news-feed',
    }))
    .filter(
      (row) =>
        row.url &&
        !['unrelated', 'conflicting'].includes(
          placeMatch(`${row.title} ${row.snippet}`, group.context),
        ) &&
        travelRelevance(row, group.context),
    );
}
async function newsFeed(group) {
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({
    q: `${group.context.city} ${group.context.region} (road closure OR weather warning OR protest OR transport disruption) when:7d`,
    hl: 'en-IN',
    gl: 'IN',
    ceid: 'IN:en',
  }).toString();
  return withRequestBudget(
    async () => {
      const response = await fetch(url, {
        signal: currentSignal(),
        headers: {
          'User-Agent':
            'TraceRisk/5.3 (https://github.com/codeby-irFAN/TraceRisk)',
        },
      });
      if (!response.ok) throw new Error('News feed unavailable.');
      const reader = response.body.getReader(),
        parts = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 1000000) throw new Error('News feed too large.');
          parts.push(Buffer.from(value));
        }
      } catch (e) {
        await reader.cancel().catch(() => {});
        throw e;
      } finally {
        reader.releaseLock();
      }
      return parseNewsFeed(Buffer.concat(parts).toString('utf8'), group);
    },
    10000,
    'News feed timed out.',
  );
}
async function gdelt(group) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.search = new URLSearchParams({
    query: `"${group.context.city.replace(/["\\]/g, '')}" (closure OR flood OR protest OR disruption) sourcecountry:IN`,
    mode: 'ArtList',
    format: 'json',
    maxrecords: '20',
    sort: 'DateDesc',
    timespan: '7d',
  }).toString();
  const data = await fetchJson(url, {}, 12000);
  return (data.articles || [])
    .slice(0, 20)
    .map((row) => ({
      url: normalizeUrl(row.url),
      title: cleanText(row.title, 220),
      snippet: cleanText(row.title, 1200),
      publishedAt: /^\d{8}T/.test(row.seendate || '')
        ? ''
        : cleanText(row.publishedAt, 60),
      indexedAt: cleanText(row.seendate, 40),
      group: group.id,
      searchMode: 'independent-news-index',
    }))
    .filter(
      (row) =>
        row.url &&
        !['unrelated', 'conflicting'].includes(
          placeMatch(row.title, group.context),
        ) &&
        travelRelevance(row, group.context),
    );
}
export async function searchThorough(group) {
  const tasks = [searchTinyFish({ ...group, timeoutMs: 8000 })];
  if (group.id === 'regional-news') tasks.push(newsFeed(group));
  if (group.id === 'traffic') tasks.push(gdelt(group));
  const outcomes = await Promise.allSettled(tasks);
  currentSignal()?.throwIfAborted();
  const rows = outcomes.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  );
  const health = outcomes.map((r, index) => ({
    provider:
      index === 0
        ? 'TinyFish'
        : group.id === 'regional-news'
          ? 'Google News RSS'
          : 'GDELT',
    status: r.status === 'fulfilled' ? 'checked' : 'unavailable',
    leads: r.status === 'fulfilled' ? r.value.length : 0,
  }));
  Object.defineProperty(rows, 'providers', { value: health });
  if (!outcomes.some((r) => r.status === 'fulfilled'))
    throw new Error('Live news providers could not be reached.');
  return rows;
}
