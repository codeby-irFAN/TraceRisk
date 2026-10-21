import {
  TINYFISH_SEARCH,
  TINYFISH_FETCH,
  SEARCH_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  FETCH_BATCH_SIZE,
} from './config.js';
import { fetchJson } from './http.js';
import { cleanText, normalizeUrl, safeDomain, sourceTrust } from './utils.js';
export function buildQueries(destination, startDate, endDate) {
  const place = buildPlaceContext(destination);
  const current = 'latest recent update';
  const recent = 10_080; // 7 days
  const recentMonth = 43_200; // 30 days

  return [
    {
      id: 'traffic',
      label: 'Traffic & road closures',
      domainType: 'news',
      recencyMinutes: recent,
      query: `${place.query} traffic police advisory road closure roadblock highway diversion waterlogging congestion accident ${current} ${startDate} ${endDate}`,
      fallbackQuery: `${place.query} traffic advisory road closure accident diversion congestion`,
    },
    {
      id: 'transport',
      label: 'Rail, airport & public transport',
      domainType: 'news',
      recencyMinutes: recent,
      query: `${place.query} train cancellation railway disruption airport flight delay metro shutdown bus strike transport advisory ${current} ${startDate} ${endDate}`,
      fallbackQuery: `${place.query} train airport metro bus cancellation delay strike disruption`,
    },
    {
      id: 'civil-unrest',
      label: 'Protests & civil unrest',
      domainType: 'news',
      recencyMinutes: recent,
      query: `${place.query} protest demonstration clash violence curfew bandh shutdown strike blockade security incident ${current}`,
      fallbackQuery: `${place.query} protest curfew clash violence strike blockade security`,
    },
    {
      id: 'official-advisories',
      label: 'Official advisories & travel restrictions',
      domainType: 'web',
      recencyMinutes: null,
      query: `${place.query} official travel advisory government police movement restriction curfew entry permit road order site:gov.in OR site:police.gov.in OR site:nic.in`,
      fallbackQuery: `${place.query} official travel advisory police curfew permit travel restriction`,
    },
    {
      id: 'health',
      label: 'Health & disease outbreaks',
      domainType: 'news',
      recencyMinutes: recentMonth,
      query: `${place.query} disease outbreak dengue malaria chikungunya contaminated water hospital public health advisory health department ${current}`,
      fallbackQuery: `${place.query} disease outbreak health advisory dengue contaminated water hospital`,
    },
    {
      id: 'crime',
      label: 'Crime & visitor safety',
      domainType: 'news',
      recencyMinutes: recentMonth,
      query: `${place.query} police warning tourist scam pickpocket theft robbery fraud safety advisory accident crime ${current}`,
      fallbackQuery: `${place.query} police advisory crime tourist scam theft safety`,
    },
    {
      id: 'infrastructure',
      label: 'Infrastructure & civic emergencies',
      domainType: 'news',
      recencyMinutes: recent,
      query: `${place.query} power outage blackout fire building collapse water supply disruption civic emergency hospital closure ${current}`,
      fallbackQuery: `${place.query} power outage fire water disruption civic emergency road closure`,
    },
    {
      id: 'regional-news',
      label: 'Regional news & local reports',
      domainType: 'news',
      recencyMinutes: recent,
      query: `${place.query} regional local news public safety road rail protest warning incident travel disruption ${current}`,
      fallbackQuery: `${place.query} local news latest incident safety travel disruption`,
    },
  ];
}
export function buildPlaceContext(destination) {
  const original = String(destination || '').trim();
  const parts = original
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const city = parts[0] || original;
  const explicitRegion = parts.slice(1).join(' ');
  const inferred = inferIndianRegion(city);
  const region = explicitRegion || inferred;
  const sameAsRegion =
    Boolean(region) &&
    city.toLocaleLowerCase('en-IN') === region.toLocaleLowerCase('en-IN');
  const query =
    region && !sameAsRegion ? `"${city}" ${region} India` : `"${city}" India`;
  return { city, region, query };
}

function inferIndianRegion(city) {
  const normalized = String(city || '')
    .toLowerCase()
    .trim();
  const map = {
    imphal: 'Manipur',
    manipur: 'Manipur',
    gangtok: 'Sikkim',
    sikkim: 'Sikkim',
    kohima: 'Nagaland',
    nagaland: 'Nagaland',
    aizawl: 'Mizoram',
    mizoram: 'Mizoram',
    itanagar: 'Arunachal Pradesh',
    shillong: 'Meghalaya',
    meghalaya: 'Meghalaya',
    guwahati: 'Assam',
    assam: 'Assam',
    agartala: 'Tripura',
    tripura: 'Tripura',
    shimla: 'Himachal Pradesh',
    manali: 'Himachal Pradesh',
    dharamshala: 'Himachal Pradesh',
    dehradun: 'Uttarakhand',
    rishikesh: 'Uttarakhand',
    nainital: 'Uttarakhand',
    srinagar: 'Jammu and Kashmir',
    jammu: 'Jammu and Kashmir',
    leh: 'Ladakh',
    mumbai: 'Maharashtra',
    pune: 'Maharashtra',
    bengaluru: 'Karnataka',
    bangalore: 'Karnataka',
    chennai: 'Tamil Nadu',
    kolkata: 'West Bengal',
    jaipur: 'Rajasthan',
    lucknow: 'Uttar Pradesh',
    varanasi: 'Uttar Pradesh',
    ayodhya: 'Uttar Pradesh',
    bhopal: 'Madhya Pradesh',
    indore: 'Madhya Pradesh',
    patna: 'Bihar',
    ranchi: 'Jharkhand',
    raipur: 'Chhattisgarh',
    hyderabad: 'Telangana',
    vijayawada: 'Andhra Pradesh',
    amaravati: 'Andhra Pradesh',
    kochi: 'Kerala',
    thiruvananthapuram: 'Kerala',
    panaji: 'Goa',
    chandigarh: 'Chandigarh',
    delhi: 'Delhi',
    'new delhi': 'Delhi',
    gurugram: 'Haryana',
    gurgaon: 'Haryana',
    faridabad: 'Haryana',
    amritsar: 'Punjab',
    ludhiana: 'Punjab',
  };
  return map[normalized] || '';
}

export async function searchTinyFish(group) {
  const runSearch = async ({ query, targeted }) => {
    const url = new URL(TINYFISH_SEARCH);
    url.searchParams.set('query', query);
    url.searchParams.set('location', 'IN');
    url.searchParams.set('language', 'en');

    if (targeted) {
      url.searchParams.set('domain_type', group.domainType || 'web');
      url.searchParams.set('page', String(group.page ?? 0));
      if (Number.isInteger(group.recencyMinutes) && group.recencyMinutes > 0) {
        url.searchParams.set('recency_minutes', String(group.recencyMinutes));
      }
    }

    const data = await fetchJson(
      url,
      {
        headers: {
          'X-API-Key': process.env.TINYFISH_API_KEY,
          'User-Agent': 'TraceRisk-App/3.2.0',
        },
      },
      SEARCH_TIMEOUT_MS,
    );

    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .filter((item) => item?.url)
      .map((item) => ({
        ...item,
        url: normalizeUrl(item.url),
        group: group.id,
        laneLabel: group.label || group.id,
        searchMode: targeted ? 'targeted' : 'broad-fallback',
        publishedAt:
          item.date ||
          item.publishedAt ||
          item.published_at ||
          item.published_date ||
          item.publication_date ||
          '',
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  };

  let targetedResults = [];
  try {
    targetedResults = await runSearch({
      query: group.query,
      targeted: true,
    });
  } catch (error) {
    if ([401, 403, 429].includes(error?.status)) throw error;
    console.warn(
      `[TraceRisk] Search lane ${group.id} targeted request failed: ${cleanText(error?.message || 'unknown error', 150)}. Trying broad fallback once.`,
    );
  }

  console.log(
    `[TraceRisk] Search lane ${group.id} (targeted/${group.domainType || 'web'}) returned ${targetedResults.length} usable results.`,
  );

  if (targetedResults.length > 0) return targetedResults;

  const fallbackQuery =
    group.fallbackQuery ||
    `${buildPlaceContext(group.query || '').query} local safety travel advisory`;

  console.warn(
    `[TraceRisk] Search lane ${group.id} returned 0 targeted results; retrying a broader query without freshness or domain-type filters.`,
  );

  const fallbackResults = await runSearch({
    query: fallbackQuery,
    targeted: false,
  });

  console.log(
    `[TraceRisk] Search lane ${group.id} (broad fallback) returned ${fallbackResults.length} usable results.`,
  );

  return fallbackResults;
}
export function rankAndSelectCandidates(results, destination, maxResults) {
  const unique = new Map();
  for (const item of results) {
    const key = normalizeUrl(item.url);
    if (!key) continue;
    const ranked = { ...item, rankScore: scoreCandidate(item, destination) };
    const existing = unique.get(key);
    if (!existing || ranked.rankScore > existing.rankScore)
      unique.set(key, ranked);
  }

  const sorted = [...unique.values()].sort((a, b) => b.rankScore - a.rankScore);
  const lanes = [
    'traffic',
    'transport',
    'civil-unrest',
    'official-advisories',
    'health',
    'crime',
    'infrastructure',
    'regional-news',
  ];
  const selected = [];
  const pickedUrls = new Set();
  const domainCounts = new Map();
  const laneCounts = new Map();

  for (let round = 0; round < 3 && selected.length < maxResults; round++) {
    for (const lane of lanes) {
      if (selected.length >= maxResults) break;
      if ((laneCounts.get(lane) || 0) >= 3) continue;
      const candidate = sorted.find(
        (item) =>
          item.group === lane &&
          !pickedUrls.has(normalizeUrl(item.url)) &&
          (domainCounts.get(safeDomain(item.url)) || 0) < (round === 0 ? 1 : 2),
      );
      if (!candidate) continue;
      const key = normalizeUrl(candidate.url);
      const domain = safeDomain(candidate.url);
      selected.push(candidate);
      pickedUrls.add(key);
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
    }
  }

  for (const item of sorted) {
    if (selected.length >= maxResults) break;
    const key = normalizeUrl(item.url);
    const domain = safeDomain(item.url);
    if (pickedUrls.has(key) || (domainCounts.get(domain) || 0) >= 3) continue;
    selected.push(item);
    pickedUrls.add(key);
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    laneCounts.set(item.group, (laneCounts.get(item.group) || 0) + 1);
  }

  for (const item of sorted) {
    if (selected.length >= maxResults) break;
    const key = normalizeUrl(item.url);
    if (pickedUrls.has(key)) continue;
    selected.push(item);
    pickedUrls.add(key);
  }

  console.log(
    `[TraceRisk] Candidate pool ${unique.size}; selected ${selected.length}; lane distribution: ${JSON.stringify(Object.fromEntries(laneCounts))}.`,
  );
  return selected.slice(0, maxResults);
}

function scoreCandidate(item, destination) {
  const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let score = 0;

  const trust = sourceTrust(item.url);
  if (trust === 'Official government') score += 24;
  if (trust === 'News outlet') score += 14;

  const { city, region } = buildPlaceContext(destination);
  const cityNorm = city.toLowerCase();
  if (cityNorm && text.includes(cityNorm)) score += 22;
  if (region && text.includes(region.toLowerCase())) score += 10;
  if (
    /alert|warning|advisory|closure|diversion|flood|landslide|heavy rain|road block|roadblock|strike|outbreak|curfew|police|traffic|disruption|cancel|waterlogging|accident|tourist safety|movement restriction|permit|protest|clash|blackout/.test(
      text,
    )
  )
    score += 16;
  if (/latest|today|current|updated|this week/.test(text)) score += 5;

  const dateValue =
    item.publishedAt ||
    item.date ||
    item.published_at ||
    item.published_date ||
    item.publication_date;
  if (dateValue) {
    const published = new Date(dateValue);
    if (!Number.isNaN(published.getTime())) {
      const ageDays = (Date.now() - published.getTime()) / 86_400_000;
      if (ageDays >= 0 && ageDays <= 7) score += 22;
      else if (ageDays > 7 && ageDays <= 30) score += 12;
      else if (ageDays > 180) score -= 22;
      else if (ageDays > 30) score -= 6;
    }
  }

  if (
    /archive|archives|annual report|historic(al)?|policy paper|national policy|scheme guidelines|recruitment|tender/.test(
      text,
    )
  )
    score -= 24;
  return score;
}

export function sourceRelevanceScore(source, destination) {
  const text =
    `${source.title || ''} ${source.snippet || ''} ${(source.text || '').slice(0, 2200)}`.toLowerCase();
  let score = 0;
  const { city, region } = buildPlaceContext(destination);
  if (city && text.includes(city.toLowerCase())) score += 3;
  if (region && text.includes(region.toLowerCase())) score += 2;
  if (
    /weather|forecast|rain|flood|landslide|road closure|road block|traffic|transport|strike|protest|curfew|police|advisory|outbreak|disease|tourist|public safety|accident|disruption|alert|warning|entry permit|movement restriction/.test(
      text,
    )
  )
    score += 3;
  if (
    /archive|archives|annual report|policy paper|national policy|historical|scheme guidelines|recruitment|tender/.test(
      text,
    )
  )
    score -= 4;
  const dateValue = source.publishedAt || source.published_date || source.date;
  if (dateValue) {
    const published = new Date(dateValue);
    if (!Number.isNaN(published.getTime())) {
      const ageDays = (Date.now() - published.getTime()) / 86_400_000;
      if (ageDays >= 0 && ageDays <= 30) score += 2;
      if (ageDays > 180) score -= 3;
    }
  }
  return score;
}

export async function fetchTinyFish(sources) {
  const mergedResults = new Map();
  const allErrors = [];
  const requestErrors = [];
  if (!sources.length)
    return { results: mergedResults, errors: allErrors, requestError: null };

  const batches = [];
  for (let index = 0; index < sources.length; index += FETCH_BATCH_SIZE) {
    batches.push(sources.slice(index, index + FETCH_BATCH_SIZE));
  }

  console.log(
    `[TraceRisk] Fetching ${sources.length} URLs in ${batches.length} parallel batch(es), at most ${FETCH_BATCH_SIZE} URLs each.`,
  );
  const outcomes = await Promise.allSettled(batches.map(fetchTinyFishBatch));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      requestErrors.push(
        `batch ${index + 1}: ${cleanText(outcome.reason?.message || 'unknown fetch error', 180)}`,
      );
      return;
    }
    for (const [url, value] of outcome.value.results.entries())
      mergedResults.set(url, value);
    allErrors.push(...outcome.value.errors);
    if (outcome.value.requestError)
      requestErrors.push(`batch ${index + 1}: ${outcome.value.requestError}`);
  });

  return {
    results: mergedResults,
    errors: allErrors,
    requestError: requestErrors.length
      ? requestErrors.join('; ').slice(0, 420)
      : null,
  };
}

async function fetchTinyFishBatch(sources) {
  const fetchedByUrl = new Map();
  let response = null;
  let requestError = null;

  try {
    response = await fetchJson(
      TINYFISH_FETCH,
      {
        method: 'POST',
        headers: {
          'X-API-Key': process.env.TINYFISH_API_KEY,
          'Content-Type': 'application/json',
          'User-Agent': 'TraceRisk-App/3.2.0',
        },
        body: JSON.stringify({
          urls: sources.map((source) => source.url),
          format: 'markdown',
          links: false,
          image_links: false,
        }),
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    requestError = cleanText(
      error?.message || 'Unknown TinyFish Fetch error',
      220,
    );
    console.warn('[TraceRisk] TinyFish Fetch batch failed:', requestError);
  }

  const results = Array.isArray(response?.results) ? response.results : [];
  const errors = Array.isArray(response?.errors) ? response.errors : [];
  if (errors.length)
    console.warn(
      `[TraceRisk] TinyFish Fetch batch reported ${errors.length} URL error(s).`,
    );

  for (const item of results) {
    const resultUrl = normalizeUrl(item?.url || '');
    const finalUrl = normalizeUrl(item?.final_url || item?.finalUrl || '');
    const text = cleanText(
      item?.text || item?.markdown || item?.content || item?.raw_content || '',
      4500,
    );
    const normalized = { title: item?.title || '', text };
    if (resultUrl) fetchedByUrl.set(resultUrl, normalized);
    if (finalUrl) fetchedByUrl.set(finalUrl, normalized);
    const matched = sources.find((source) => {
      const original = normalizeUrl(source.url);
      return original && (original === resultUrl || original === finalUrl);
    });
    if (matched) fetchedByUrl.set(normalizeUrl(matched.url), normalized);
  }

  const failedResults = Array.isArray(response?.failed_results)
    ? response.failed_results
    : [];
  errors.push(...failedResults);
  return { results: fetchedByUrl, errors, requestError };
}
