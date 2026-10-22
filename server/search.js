import {
  TINYFISH_SEARCH,
  TINYFISH_FETCH,
  SEARCH_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  FETCH_BATCH_SIZE,
  hasCredential,
} from './config.js';
import {
  fetchJson,
  withRequestBudget,
  currentSignal,
  createConcurrencyGate,
} from './http.js';
import { cleanText, normalizeUrl, sourceTrust } from './utils.js';
import {
  placeContext,
  placeMatch,
  publisherKey,
  publicationDay,
  travelRelevance,
} from './evidence.js';

const searchGate = createConcurrencyGate(24);
const extractionGate = createConcurrencyGate(12);
export function buildPlaceContext(destination) {
  const context = placeContext(destination);
  return {
    ...context,
    query: `"${context.city.replace(/["\\]/g, '')}" ${context.region} India`
      .replace(/\s+/g, ' ')
      .trim(),
  };
}
export function buildQueries(destination, _startDate, _endDate, location) {
  const context = placeContext(destination, location);
  const place =
    `"${context.city.replace(/["\\]/g, '')}" ${context.region.toLowerCase() === context.city.toLowerCase() ? '' : context.region} India`
      .replace(/\s+/g, ' ')
      .trim();
  const lanes = [
    [
      'traffic',
      'Traffic & road closures',
      '(traffic advisory OR road closed)',
      'traffic update',
    ],
    [
      'transport',
      'Rail, airport & public transport',
      '(train cancelled OR flight disruption)',
      'train airport bus updates',
    ],
    [
      'civil-unrest',
      'Protests & civil unrest',
      '(protest OR curfew OR bandh)',
      'local security updates',
    ],
    [
      'official-advisories',
      'Official advisories & travel restrictions',
      '(traffic OR disaster) advisory (site:gov.in OR site:nic.in)',
      'official travel advisory',
    ],
    [
      'health',
      'Health & disease outbreaks',
      '(health advisory OR outbreak)',
      'health department updates',
    ],
    [
      'crime',
      'Crime & visitor safety',
      '(police advisory OR tourist scam)',
      'visitor safety advisory',
    ],
    [
      'infrastructure',
      'Infrastructure & civic emergencies',
      '(power outage OR water disruption)',
      'local infrastructure updates',
    ],
    [
      'regional-news',
      'Regional news & local reports',
      '(travel advisory OR landslide OR flood)',
      'latest local news',
    ],
  ];
  return lanes.map(([id, label, terms, broad]) => ({
    id,
    label,
    context,
    domainType: id === 'official-advisories' ? 'web' : 'news',
    recencyMinutes:
      id === 'health' || id === 'official-advisories' ? 43_200 : 20_160,
    query: `${id === 'regional-news' && context.landmark ? `"${context.landmark.replace(/["\\]/g, '')}" ${context.city} India` : place} ${terms}`,
    fallbackQuery: `${place} ${broad}`,
  }));
}

export async function searchTinyFish(group) {
  if (!hasCredential('TINYFISH_API_KEY'))
    throw Object.assign(new Error('Web search is not configured.'), {
      code: 'MISSING_SEARCH_KEY',
    });
  const search = async (targeted) =>
    withRequestBudget(
      () =>
        searchGate(async () => {
          const url = new URL(TINYFISH_SEARCH);
          url.searchParams.set(
            'query',
            targeted ? group.query : group.fallbackQuery,
          );
          url.searchParams.set('location', 'IN');
          url.searchParams.set('language', 'en');
          if (targeted) {
            url.searchParams.set('domain_type', group.domainType || 'web');
            if (group.recencyMinutes)
              url.searchParams.set(
                'recency_minutes',
                String(group.recencyMinutes),
              );
          }
          const data = await fetchJson(
            url,
            {
              headers: { 'X-API-Key': process.env.TINYFISH_API_KEY },
              retryRateLimit: false,
            },
            group.timeoutMs || SEARCH_TIMEOUT_MS,
          );
          const rows = data?.results ?? data?.data?.results;
          if (!Array.isArray(rows))
            throw new Error(
              'Search provider returned an unsupported response shape.',
            );
          return rows
            .slice(0, 30)
            .map((item) => ({
              url: normalizeUrl(item?.url),
              title: cleanText(item?.title, 220),
              snippet: cleanText(item?.snippet || item?.description, 1200),
              publishedAt: cleanText(
                item?.date ||
                  item?.publishedAt ||
                  item?.published_at ||
                  item?.published_date ||
                  item?.publication_date,
                60,
              ),
              group: group.id,
              searchMode: targeted ? 'targeted' : 'broad-fallback',
            }))
            .filter(
              (item) =>
                item.url &&
                (!group.context ||
                  (!['unrelated', 'conflicting'].includes(
                    placeMatch(`${item.title} ${item.snippet}`, group.context),
                  ) &&
                    travelRelevance(item, group.context))),
            )
            .slice(0, 10);
        }),
      group.timeoutMs || SEARCH_TIMEOUT_MS,
      'Search attempt exceeded its time budget.',
    );
  let firstError;
  try {
    const rows = await search(true);
    if (rows.length) return rows;
  } catch (error) {
    currentSignal()?.throwIfAborted();
    if ([401, 403, 429].includes(error.status)) throw error;
    firstError = error;
  }
  const rows = await search(false);
  // Empty fallback is still a completed search, with no implication about safety.
  Object.defineProperty(rows, 'searchMode', { value: 'broad-fallback' });
  if (firstError)
    Object.defineProperty(rows, 'warning', {
      value: cleanText(firstError.message, 160),
    });
  return rows;
}

export function sourceRelevanceScore(source, destination, location) {
  const match = placeMatch(
    `${source.title || ''} ${source.snippet || ''} ${source.text || ''}`,
    placeContext(destination, location),
  );
  return match === 'city'
    ? 6
    : match === 'region'
      ? 4
      : match === 'ambiguous'
        ? 2
        : 0;
}

export function rankAndSelectCandidates(
  results,
  destination,
  maxResults,
  location,
  now = Date.now(),
) {
  const unique = new Map();
  for (const item of results.slice(0, 240)) {
    const url = normalizeUrl(item.url);
    if (!url) continue;
    const relevance = sourceRelevanceScore(item, destination, location);
    if (!relevance) continue;
    const day = publicationDay(item.publishedAt || item.date);
    const relative = String(item.publishedAt || '').match(
      /(\d+)\s*(minute|hour|day|week)s?\s*ago/i,
    );
    // Relative search ages help ranking only; they never establish a claim's date.
    const age = day
      ? (now - Date.parse(day)) / 86_400_000
      : relative
        ? Number(relative[1]) *
          { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7 }[
            relative[2].toLowerCase()
          ]
        : null;
    const rankScore =
      relevance * 10 +
      (travelRelevance(item, placeContext(destination, location)) ? 25 : -30) +
      (sourceTrust(url) === 'Official government' ? 12 : 0) +
      (age !== null && age >= 0 && age < 8
        ? 15
        : age !== null && (age < 0 || age > 30)
          ? -12
          : 0);
    const previous = unique.get(url);
    const groups = [...new Set([...(previous?.groups || []), item.group])];
    if (!previous || rankScore > previous.rankScore)
      unique.set(url, { ...item, url, rankScore, groups });
    else previous.groups = groups;
  }
  const sorted = [...unique.values()].sort(
    (a, b) => b.rankScore - a.rankScore || a.url.localeCompare(b.url),
  );
  const selected = [],
    used = new Set(),
    publishers = new Map();
  const lanes = [...new Set(results.map((r) => r.group))];
  const add = (item) => {
    selected.push(item);
    used.add(item.url);
    const domain = publisherKey(item.url);
    publishers.set(domain, (publishers.get(domain) || 0) + 1);
  };
  for (const lane of lanes) {
    if (selected.length >= maxResults) break;
    const item = sorted.find(
      (r) =>
        r.groups.includes(lane) &&
        !used.has(r.url) &&
        (publishers.get(publisherKey(r.url)) || 0) < 2,
    );
    if (item) add(item);
  }
  for (const item of sorted) {
    if (selected.length >= maxResults) break;
    if (
      !used.has(item.url) &&
      (publishers.get(publisherKey(item.url)) || 0) < 3
    )
      add(item);
  }
  return selected;
}

export async function fetchTinyFish(
  sources,
  { timeoutMs = FETCH_TIMEOUT_MS, onPartial } = {},
) {
  const results = new Map(),
    errors = [];
  onPartial?.({ results, errors, requestError: null });
  const batches = [];
  for (let i = 0; i < sources.length; i += FETCH_BATCH_SIZE)
    batches.push(sources.slice(i, i + FETCH_BATCH_SIZE));
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await withRequestBudget(
          () =>
            extractionGate(() =>
              fetchJson(
                TINYFISH_FETCH,
                {
                  method: 'POST',
                  headers: {
                    'X-API-Key': process.env.TINYFISH_API_KEY,
                    'Content-Type': 'application/json',
                  },
                  retryRateLimit: false,
                  body: JSON.stringify({
                    urls: batch.map((s) => s.url),
                    format: 'markdown',
                    links: false,
                    image_links: false,
                  }),
                },
                timeoutMs,
              ),
            ),
          timeoutMs,
          'Page extraction exceeded its time budget.',
        );
        currentSignal()?.throwIfAborted();
        if (!Array.isArray(response?.results))
          throw new Error(
            'Extraction provider returned an unsupported response shape.',
          );
        const allowed = new Set(batch.map((s) => normalizeUrl(s.url)));
        for (const item of response.results.slice(0, FETCH_BATCH_SIZE * 2)) {
          const original = normalizeUrl(item?.url || item?.requested_url);
          // A redirect destination alone cannot identify the requested document.
          if (!allowed.has(original)) continue;
          const finalUrl = normalizeUrl(
            item?.final_url || item?.finalUrl || original,
          );
          if (!finalUrl) continue;
          const text = cleanText(
            item?.text || item?.markdown || item?.content || item?.raw_content,
            60_000,
          );
          if (text)
            results.set(original, {
              text,
              title: cleanText(item?.title, 220),
              finalUrl,
              publishedAt: cleanText(
                item?.published_date ||
                  item?.publishedAt ||
                  item?.datePublished,
                60,
              ),
            });
        }
        for (const item of batch)
          if (!results.has(item.url))
            errors.push({
              url: item.url,
              error: 'No extracted page returned.',
            });
      } catch (error) {
        currentSignal()?.throwIfAborted();
        errors.push(
          ...batch.map((item) => ({
            url: item.url,
            error: cleanText(error.message, 160),
          })),
        );
      }
    }),
  );
  return {
    results,
    errors,
    requestError: errors.length
      ? `${errors.length} page(s) could not be opened.`
      : null,
  };
}
