import { createHash } from 'node:crypto';
import {
  cleanText,
  isDate,
  safeDomain,
  sourceTrust,
  escapeRegex,
} from './utils.js';

const DAY = 86_400_000;
const STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Ladakh',
  'Jammu and Kashmir',
];
const ALIASES = {
  bengaluru: ['Bangalore'],
  mumbai: ['Bombay'],
  chennai: ['Madras'],
  kolkata: ['Calcutta'],
  'new delhi': ['Delhi'],
  gurugram: ['Gurgaon'],
  thiruvananthapuram: ['Trivandrum'],
};
const AMBIGUOUS = new Set([
  'manali',
  'rampur',
  'srinagar',
  'bilaspur',
  'aurangabad',
  'hamirpur',
  'pratapgarh',
]);
export const normalText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
function hasPlace(text, place) {
  return (
    Boolean(place) &&
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegex(normalText(place))}($|[^\\p{L}\\p{N}])`,
      'u',
    ).test(normalText(text))
  );
}
export function placeContext(destination, location) {
  const parts = String(destination)
    .split(',')
    .map((x) => x.trim());
  const city = location?.city || location?.name || parts[0];
  const region =
    location?.admin1 ||
    parts.slice(1).find((x) => x.toLowerCase() !== 'india') ||
    '';
  return {
    city,
    landmark: location?.kind === 'landmark' ? location.name : null,
    region,
    aliases: [
      city,
      ...(location?.kind === 'landmark' ? [location.name] : []),
      ...(ALIASES[normalText(city)] || []),
    ],
  };
}
export function placeMatch(text, context) {
  const value = normalText(text);
  const city = context.aliases.some((name) => hasPlace(value, name));
  const region = hasPlace(value, context.region);
  const conflicting = STATES.some(
    (state) =>
      normalText(state) !== normalText(context.region) &&
      context.aliases.some((name) =>
        new RegExp(
          `${escapeRegex(normalText(name))}\\s*(?:,|in|of)\\s*${escapeRegex(normalText(state))}\\b`,
        ).test(value),
      ),
  );
  if (conflicting) return 'conflicting';
  if (city && AMBIGUOUS.has(normalText(context.city)) && !region)
    return 'ambiguous';
  return city ? 'city' : region ? 'region' : 'unrelated';
}

const TYPES = [
  {
    key: 'restriction',
    pattern:
      /\b(curfew|movement restriction|entry ban|travel ban|evacuation order|section 144)\b/i,
    title: 'Movement restriction report',
    dimension: 'Geopolitical & Civil',
    score: 64,
    impact: 'Check the current order with local authorities before travelling.',
  },
  {
    key: 'transport',
    pattern:
      /\b(road closures?|roads? (?:is |are |remain[s]? )?(?:closed|blocked)|roadblock|traffic diversions?|traffic restrictions?|highway blocked|cancelled|canceled|cancellations?|transport strike|trains? suspended|flights? suspended|services? suspended)\b/i,
    title: 'Transport disruption report',
    dimension: 'Infrastructure / Transit',
    score: 52,
    impact:
      'Confirm route or service status with the transport operator before departure.',
  },
  {
    key: 'unrest',
    pattern:
      /\b(violent protest|clashes|violence|blockade|bandh|shutdown|protest march)\b/i,
    title: 'Local disruption report',
    dimension: 'Geopolitical & Civil',
    score: 55,
    impact:
      'Check local police updates and access restrictions for your route.',
  },
  {
    key: 'weather',
    pattern:
      /\b(flood warning|flooding|landslide|heavy rainfall warning|cyclone warning|avalanche warning)\b/i,
    title: 'Environmental advisory report',
    dimension: 'Environmental',
    score: 60,
    impact:
      'Check official weather and disaster-management updates before setting out.',
  },
  {
    key: 'health',
    pattern:
      /\b(outbreak|contaminated water|public health alert|health advisory)\b/i,
    title: 'Health advisory report',
    dimension: 'Health & Medical',
    score: 45,
    impact:
      'Check the local health department advice and any precautions applicable to your trip.',
  },
  {
    key: 'infrastructure',
    pattern:
      /\b(power outage|blackout|water supply disruption|bridge closed|building collapse|major fire)\b/i,
    title: 'Infrastructure disruption report',
    dimension: 'Infrastructure / Transit',
    score: 45,
    impact:
      'Confirm access and essential services with your accommodation or local authority.',
  },
  {
    key: 'crime',
    pattern:
      /\b(police warn|police warning|scam warning|tourist scam|fraud advisory)\b/i,
    title: 'Visitor advisory report',
    dimension: 'Micro-Crime Trends',
    score: 28,
    impact: 'Read the cited police advice and check with local authorities.',
  },
];
const NEGATED =
  /\b(no (?:active |current |new |reported )?(?:road closures?|closures?|curfew|warnings?|disruptions?|flooding|outbreak|restrictions?|protests?)|none (?:cancelled|canceled|closed)|not (?:closed|cancelled|canceled|in effect)|(?:warning|curfew|restriction|closure|ban)[^.]{0,55}\b(?:lifted|withdrawn|cancelled|canceled|expired|ended)|reopened|services? resumed|back to normal|false alarm)\b/i;
const GENERIC =
  /\b(historical|last year|years? ago|anniversary|safety tips|travel guide|prone to|could occur|may occur|might occur|hypothetical|simulation|mock drill|ignore (?:all |previous )?instructions|system prompt|(?:check|confirm|monitor|verify)[^.]{0,35}(?:road closures|current warnings|possible disruption))\b/i;
export function disruptionType(quote) {
  if (NEGATED.test(quote) || GENERIC.test(quote)) return null;
  return TYPES.find((type) => type.pattern.test(quote)) || null;
}

const TRAVEL_TOPIC =
  /\b(traffic|roads?|highways?|railway|trains?|flights?|airport|transport|curfew|restrictions?|protests?|clashes|violence|bandh|strike|floods?|flooding|landslides?|rainfall|cyclone|avalanche|heatwave|air quality|pollution|outbreak|dengue|cholera|health advisory|power outage|blackout|water supply|bridge|fire|police|tourist scam|travel advisory|evacuation)\b/i;
const OFF_TOPIC =
  /\b(advisory committee|recruitment|tenders?|bilateral trade|business summit|medical assistance|humanitarian (?:aid|assistance)|relief (?:shipment|supplies)|sends? .*?aid|new police station|highway projects|dam project)\b/i;
export function travelRelevance(source, context) {
  const title = String(source.title || '');
  const body = String(source.snippet || source.text || '').slice(0, 3200);
  if (
    OFF_TOPIC.test(title) ||
    /^(?:home|contact us|road safety)\s*\|/i.test(title)
  )
    return false;
  // A person's home state is not where an incident occurred.
  if (
    /\b(?:student|resident|native|man|woman)\b.+\b(?:in|near)\b/i.test(title) &&
    !context.aliases.some((name) => hasPlace(title, name))
  )
    return false;
  if (
    ['city', 'region'].includes(placeMatch(title, context)) &&
    TRAVEL_TOPIC.test(title)
  )
    return true;
  // Remove news-agency datelines: the filing office is not the incident location.
  const withoutDateline = body.replace(
    /^(?:new\s+)?[\p{L} .-]+,?\s+(?:[A-Z][a-z]{2,8}\s+\d{1,2}|\d{1,2}\s+[A-Z][a-z]{2,8})[^:]{0,40}[:–-]\s*/u,
    '',
  );
  return withoutDateline
    .split(/(?<=[.!?])\s+|\n+/)
    .some(
      (part) =>
        part.length <= 900 &&
        !OFF_TOPIC.test(part) &&
        ['city', 'region'].includes(placeMatch(part, context)) &&
        TRAVEL_TOPIC.test(part),
    );
}

export function publicationDay(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Relative dates and ambiguous numeric formats are deliberately not guessed.
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && isDate(value.slice(0, 10)))
    return value.slice(0, 10);
  if (
    !/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(
      value,
    ) ||
    !/\b20\d{2}\b/.test(value)
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
}

export function inspectSource(source, context, now = Date.now()) {
  const body = `${source.title || ''}\n${source.fetched ? source.text : source.snippet || source.text || ''}`;
  const match = placeMatch(body, context);
  const publishedDay = publicationDay(source.publishedAt);
  const age = publishedDay
    ? (Date.parse(new Date(now).toISOString().slice(0, 10)) -
        Date.parse(publishedDay)) /
      DAY
    : null;
  const recency =
    age === null
      ? 'unknown'
      : age < 0
        ? 'future-publication'
        : age <= 7
          ? 'recent'
          : age <= 30
            ? 'older'
            : 'historical';
  const topical = travelRelevance(source, context);
  const relevant = ['city', 'region'].includes(match) && topical;
  const reasons = [];
  if (!topical)
    reasons.push('No local travel condition was identified in this source.');
  if (!relevant)
    reasons.push(
      match === 'ambiguous'
        ? 'The state could not be matched for this place name.'
        : match === 'conflicting'
          ? 'The source names a different state.'
          : 'The confirmed destination was not matched.',
    );
  if (!source.fetched) reasons.push('Only a search snippet was available.');
  if (recency !== 'recent')
    reasons.push(
      recency === 'unknown'
        ? 'The publication date is unknown.'
        : recency === 'future-publication'
          ? 'The publication date is in the future.'
          : 'This report needs a current-status check.',
    );
  return {
    placeMatch: match,
    recency,
    publishedDay,
    relevant,
    topical,
    reasons,
  };
}

export function evidenceExcerpt(text, context, maxChars = 3200) {
  const full = cleanText(text, 60_000);
  if (full.length <= maxChars) return full;
  const paragraphs = full
    .split(/\n+/)
    .flatMap((p) => (p.length > 1400 ? p.split(/(?<=[.!?])\s+/) : [p]));
  const selected = paragraphs
    .map((value, index) => ({
      value,
      index,
      score:
        (['city', 'region'].includes(placeMatch(value, context)) ? 4 : 0) +
        (disruptionType(value) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let remaining = maxChars;
  const kept = [];
  for (const part of selected) {
    if (remaining < 80) break;
    const value = part.value.slice(0, remaining - 1);
    kept.push({ ...part, value });
    remaining -= value.length + 1;
  }
  return kept
    .sort((a, b) => a.index - b.index)
    .map((p) => p.value)
    .join('\n');
}

function datesInQuote(quote, referenceDay) {
  const iso = quote.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const dotted = [
    ...quote.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g),
  ].map((m) => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  const month =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const named =
    quote.match(
      new RegExp(
        `\\b(?:\\d{1,2}\\s+${month}\\s+20\\d{2}|${month}\\s+\\d{1,2},?\\s+20\\d{2})\\b`,
        'gi',
      ),
    ) || [];
  const fullDates = [
    ...new Set(
      [...iso, ...dotted, ...named.map(publicationDay)].filter(isDate),
    ),
  ].sort();
  if (fullDates.length || !referenceDay) return fullDates;
  // Current reports often say "October 21, 22". Infer only the year, within
  // 45 days of a known publication date; expose that inference in dateBasis.
  const partial = [
    ...quote.matchAll(
      new RegExp(
        `\\b(${month})\\s+(\\d{1,2})(?:\\s*(?:,|and|to|-)\\s*(\\d{1,2})(?!\\d))?\\b|\\b(\\d{1,2})\\s+(${month})\\b`,
        'gi',
      ),
    ),
  ];
  const year = Number(referenceDay.slice(0, 4));
  const inferred = [];
  for (const match of partial) {
    const days = match[1] ? [match[2], match[3]].filter(Boolean) : [match[4]];
    const monthName = match[1] || match[5];
    for (const day of days) {
      const options = [year - 1, year, year + 1]
        .map((y) => publicationDay(`${monthName} ${day}, ${y}`))
        .filter(Boolean);
      const closest = options.sort(
        (a, b) =>
          Math.abs(Date.parse(a) - Date.parse(referenceDay)) -
          Math.abs(Date.parse(b) - Date.parse(referenceDay)),
      )[0];
      if (
        closest &&
        Math.abs(Date.parse(closest) - Date.parse(referenceDay)) <= 45 * DAY
      )
        inferred.push(closest);
    }
  }
  return [...new Set(inferred)].sort();
}
function dateSupport(quote, quality, trip, now) {
  const explicit = datesInQuote(quote);
  const dates = explicit.length
    ? explicit
    : datesInQuote(
        quote,
        quality.recency === 'recent' ? quality.publishedDay : null,
      );
  const basis = explicit.length
    ? 'explicit-trip-dates'
    : 'event-dates-with-publication-year';
  if (dates.length) {
    // A range needs explicit range wording; two disconnected dates aren't an interval.
    if (
      dates.length === 2 &&
      /\b(?:from|between)\b.+\b(?:to|through|until|and)\b/i.test(quote)
    )
      return dates[0] <= trip.endDate && dates[1] >= trip.startDate
        ? basis
        : null;
    return dates.some((date) => date >= trip.startDate && date <= trip.endDate)
      ? basis
      : null;
  }
  // Do not mistake a recent article about a different event date for today's conditions.
  // Incomplete dates stay as leads until a complete date can be established.
  if (
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:yesterday|tomorrow|next week|last week|20\d{2})\b/i.test(
      quote,
    )
  )
    return null;
  const today = new Date(now).toISOString().slice(0, 10);
  // A recent report is context for an imminent trip, not a prediction months ahead.
  const nearTrip =
    trip.endDate >= today &&
    Date.parse(trip.startDate) <= Date.parse(today) + 2 * DAY;
  const recentlyPublished =
    quality.publishedDay &&
    Date.parse(quality.publishedDay) >= Date.parse(today) - 2 * DAY;
  return quality.recency === 'recent' && recentlyPublished && nearTrip
    ? 'recent-report-recheck-before-travel'
    : null;
}

export function deterministicClaims(sources, context) {
  return sources.flatMap((source) => {
    const text = source.fetched ? source.text : source.snippet || source.text;
    return String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .filter(
        (quote) =>
          quote.length >= 35 &&
          quote.length <= 900 &&
          disruptionType(quote) &&
          ['city', 'region'].includes(placeMatch(quote, context)),
      )
      .slice(0, 2)
      .map((quote) => ({ citations: [{ sourceId: source.id, quote }] }));
  });
}

export function verifyClaims(rawClaims, sources, trip, now = Date.now()) {
  const context = placeContext(trip.destination, trip.location);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const claims = new Map();
  const rejected = [];
  for (const raw of (Array.isArray(rawClaims) ? rawClaims : []).slice(0, 24)) {
    const valid = [];
    for (const citation of (Array.isArray(raw?.citations)
      ? raw.citations
      : []
    ).slice(0, 4)) {
      const source = byId.get(citation?.sourceId);
      let quote = cleanText(citation?.quote, 900);
      if (
        !source ||
        source.group === 'weather-api' ||
        quote.length < 35 ||
        !normalText(source.text).includes(normalText(quote))
      )
        continue;
      // Restore the surrounding sentence so a model cannot omit "no", "lifted", etc.
      const passage = String(source.text)
        .split(/(?<=[.!?])\s+|\n+/)
        .find((part) => normalText(part).includes(normalText(quote)));
      if (!passage || passage.length > 900) continue;
      quote = cleanText(passage, 900);
      const quality = source.quality || inspectSource(source, context, now);
      const type = disruptionType(quote);
      const scope = placeMatch(quote, context);
      const timing = dateSupport(quote, quality, trip, now);
      if (
        !source.fetched ||
        !quality.relevant ||
        quality.recency === 'future-publication' ||
        !['city', 'region'].includes(scope) ||
        !type ||
        !timing
      )
        continue;
      valid.push({ source, quote, type, scope, timing });
    }
    if (!valid.length) {
      rejected.push('No fetched, place-matched, date-supported quotation.');
      continue;
    }
    // A model's title, narrative, confidence and score are never factual authority.
    for (const entry of valid) {
      // One report per category and area from a document. Prefer a substantive,
      // date-supported passage over a repeated headline from that same page.
      const sameDocument = [...claims.entries()].find(
        ([, claim]) =>
          claim.sourceIds.includes(entry.source.id) &&
          claim.dimension === entry.type.dimension &&
          claim.area ===
            (entry.scope === 'region' ? context.region : context.city) &&
          claim.score === entry.type.score,
      );
      if (sameDocument) {
        const [oldKey, old] = sameDocument;
        const rank = (q, timing) =>
          Number(timing !== 'recent-report-recheck-before-travel') * 1000 +
          q.length;
        if (
          rank(old.evidence, old.dateBasis) >= rank(entry.quote, entry.timing)
        )
          continue;
        // Preserve separately attributed duplicates if the previous quote was shared.
        if (old.sourceIds.length > 1)
          old.sourceIds = old.sourceIds.filter((id) => id !== entry.source.id);
        else claims.delete(oldKey);
      }
      const key = `${entry.type.key}|${normalText(entry.quote).replace(/^[#*\s]+/, '')}`;
      const previous = claims.get(key);
      if (previous) {
        if (!previous.sourceIds.includes(entry.source.id))
          previous.sourceIds.push(entry.source.id);
      } else {
        const score = entry.type.score;
        claims.set(key, {
          title: `${entry.type.title} — ${entry.scope === 'region' ? context.region : context.city}`,
          dimension: entry.type.dimension,
          severity: score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'low',
          score,
          confidence: 0.6,
          evidenceStatus: 'Source-supported report',
          dateBasis: entry.timing,
          area: entry.scope === 'region' ? context.region : context.city,
          summary: `The source reports: “${entry.quote}”`,
          travelerImpact: entry.type.impact,
          evidence: entry.quote,
          sourceIds: [entry.source.id],
        });
      }
    }
  }
  const issues = [...claims.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((issue, i) => ({ ...issue, id: `issue-${i + 1}` }));
  return { issues, rejectedCount: rejected.length };
}

export function buildLeads(sources, issues, context) {
  const cited = new Set(issues.flatMap((i) => i.sourceIds));
  return sources
    .filter((s) => s.quality?.relevant && !cited.has(s.id))
    .sort(
      (a, b) =>
        Number(b.quality.recency === 'recent') -
          Number(a.quality.recency === 'recent') ||
        Number(b.fetched) - Number(a.fetched),
    )
    .slice(0, 8)
    .map((s) => ({
      id: `lead-${s.id}`,
      title: s.title,
      sourceIds: [s.id],
      excerpt: context
        ? evidenceExcerpt(s.text || s.snippet, context, 450)
        : cleanText(s.text || s.snippet, 450),
      status: 'Source to review',
      reason:
        s.quality.reasons.join(' ') ||
        'A relevant report was found; its applicability to this trip has not been established.',
    }));
}

export function contentHash(value) {
  return createHash('sha256').update(normalText(value)).digest('hex');
}
export function publisherKey(url) {
  const host = safeDomain(url);
  // Count subdomains of the same publisher once. This is diversity, not corroboration.
  const parts = host.split('.');
  return parts
    .slice(/\.(?:co|gov|nic|org)\.in$/.test(host) ? -3 : -2)
    .join('.');
}

export function publicSource(candidate, extracted, index, context, now) {
  const usefulExtraction = Boolean(
    extracted?.text &&
      TRAVEL_TOPIC.test(extracted.text) &&
      extracted.text.length >= 35,
  );
  const text = evidenceExcerpt(
    (usefulExtraction && extracted.text) ||
      candidate.snippet ||
      candidate.title,
    context,
  );
  const url = extracted?.finalUrl || candidate.url;
  const source = {
    id: `S${index + 1}`,
    title: cleanText(
      extracted?.title || candidate.title || 'Source report',
      220,
    ),
    url,
    originalUrl: candidate.url,
    domain: safeDomain(url),
    trust: sourceTrust(url),
    group: candidate.group,
    groups: candidate.groups || [candidate.group],
    publishedAt: cleanText(
      extracted?.publishedAt || candidate.publishedAt || candidate.date || '',
      60,
    ),
    publicationDateBasis: extracted?.publishedAt
      ? 'extraction-metadata'
      : candidate.publishedAt || candidate.date
        ? 'search-metadata'
        : 'unknown',
    snippet: cleanText(candidate.snippet, 900),
    text,
    fetched: usefulExtraction,
    retrievedAt: new Date(now).toISOString(),
    contentHash: contentHash(text),
  };
  source.quality = inspectSource(source, context, now);
  return source;
}
