import { createHash } from 'node:crypto';
import { normalText, publisherKey, publicationDay } from './evidence.js';
import { cleanText } from './utils.js';

const DAY = 86400000;
const hash = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);
const words = (text) =>
  new Set(
    normalText(text)
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            'with',
            'from',
            'that',
            'this',
            'have',
            'been',
            'will',
            'traffic',
            'police',
            'report',
            'roads',
            'road',
            'advisory',
          ].includes(w),
      ),
  );
function overlap(a, b) {
  const left = words(a),
    right = words(b);
  return (
    [...left].filter((word) => right.has(word)).length /
    Math.max(1, Math.min(left.size, right.size))
  );
}
export function explicitCoordinates(text) {
  const match = String(text).match(
    /\blatitude\s*[:=]?\s*(-?\d{1,2}\.\d{3,})\s*[,;\s]+longitude\s*[:=]?\s*(-?\d{1,3}\.\d{3,})/i,
  );
  if (!match) return null;
  const latitude = Number(match[1]),
    longitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? {
        latitude,
        longitude,
        basis: 'Coordinates explicitly present in the cited passage',
      }
    : null;
}
export function evidenceDetails(
  issues,
  sources,
  checkedAt = new Date().toISOString(),
) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  return issues.map((issue) => {
    const linked = (issue.sourceIds || [])
      .map((id) => sourceMap.get(id))
      .filter(Boolean);
    const matching = issues.filter(
      (other) =>
        other.id !== issue.id &&
        other.dimension === issue.dimension &&
        other.area === issue.area &&
        overlap(issue.evidence, other.evidence) >= 0.65,
    );
    const supporting = [
      ...new Map(
        [
          ...linked,
          ...matching.flatMap((i) =>
            i.sourceIds.map((id) => sourceMap.get(id)).filter(Boolean),
          ),
        ].map((s) => [s.id, s]),
      ).values(),
    ];
    const opposing = sources.filter(
      (s) =>
        s.fetched &&
        s.quality?.relevant &&
        s.quality?.recency === 'recent' &&
        /\b(reopened|restrictions? lifted|services? resumed|warning withdrawn)\b/i.test(
          s.text || s.preview || '',
        ) &&
        overlap(issue.evidence, s.text || s.preview) >= 0.6,
    );
    const publishers = new Set(supporting.map((s) => publisherKey(s.url))).size;
    const forecast = linked.some(
      (s) => s.group === 'weather-api' || s.group === 'air-quality-api',
    );
    const dates = [
      ...new Set(
        String(issue.evidence || '').match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [],
      ),
    ];
    const label = opposing.length
      ? 'Conflicting reports'
      : forecast
        ? 'Model forecast'
        : publishers >= 2
          ? 'Multiple publishers report this'
          : 'Single-source report';
    return {
      ...issue,
      verification: {
        label,
        confidence: opposing.length
          ? 'Uncertain'
          : forecast
            ? 'Model-based'
            : publishers >= 2
              ? 'Corroborating reports'
              : 'Limited corroboration',
        explanation:
          'Evidence strength describes source support, not a probability that travel is safe. Similar reports can share an original source.',
        affectedArea: issue.area,
        eventDates: dates,
        dateBasis: issue.dateBasis || 'Unknown',
        eventDateNote: dates.length
          ? dates.join(', ')
          : issue.dateBasis === 'event-dates-with-publication-year'
            ? 'Month/day appears in the quotation; year inferred from publication.'
            : 'Exact event dates are not established; see the quotation and publication date.',
        checkedAt,
        supporting: supporting.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          publishedAt: s.publishedAt,
          retrievedAt: s.retrievedAt || checkedAt,
          fetched: s.fetched,
        })),
        conflicts: opposing.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          quote: cleanText(s.text || s.preview, 450),
        })),
        coordinates: issue.coordinates || explicitCoordinates(issue.evidence),
      },
    };
  });
}
export function impactFor(issue, preferences = {}) {
  const impacts = [];
  const mode = preferences.mode || 'car';
  if (issue.dimension === 'Infrastructure / Transit') {
    if (['car', 'bus', 'motorcycle'].includes(mode))
      impacts.push(
        'Confirm the affected road stretch and allow a diversion buffer; published journey times exclude live closures.',
      );
    if (mode === 'train')
      impacts.push(
        'Check the train number and station access with Indian Railways; a nearby road report does not establish a train cancellation.',
      );
    if (mode === 'flight')
      impacts.push(
        'Check flight status and airport access separately; local road conditions may affect the transfer.',
      );
  }
  if (issue.dimension === 'Environmental') {
    impacts.push(
      mode === 'motorcycle'
        ? 'Rain, wind and reduced visibility can have a greater impact on a motorcycle journey. Consider a different departure time.'
        : 'Check the forecast near departure and keep a fallback for outdoor activities or transfers.',
    );
    if (preferences.children)
      impacts.push(
        'Plan indoor breaks, drinking water and additional time for children.',
      );
    if (preferences.respiratory)
      impacts.push(
        'Review local air-quality guidance and your usual clinician-advised precautions; forecasts are not medical advice.',
      );
  }
  if (preferences.limitedMobility)
    impacts.push(
      'Verify step-free transfers, accessible accommodation and whether any diversion changes access.',
    );
  if (preferences.children && issue.dimension === 'Geopolitical & Civil')
    impacts.push(
      'Avoid reported gathering areas and confirm a direct arrival route with your accommodation.',
    );
  return impacts.length
    ? impacts
    : [
        issue.travelerImpact ||
          'Confirm the current local situation and whether it affects your plans.',
      ];
}
export function coverageChecks(result) {
  const lanes = result.searchLaneStats || [];
  const groups = [
    [
      'weather',
      'Weather for your dates',
      result.weather?.forecastCoverage === 'complete'
        ? 'checked'
        : result.weather?.forecastDaysMatched
          ? 'partial'
          : 'unknown',
      `${result.weather?.forecastDaysMatched || 0} of ${result.weather?.tripDays || 0} days covered`,
    ],
    [
      'transport',
      'Transport and road reports',
      ...laneState(
        lanes.filter((s) =>
          ['traffic', 'transport', 'infrastructure'].includes(s.id),
        ),
      ),
    ],
    [
      'advisories',
      'Restrictions and local reports',
      ...laneState(
        lanes.filter((s) =>
          ['official-advisories', 'civil-unrest', 'regional-news'].includes(
            s.id,
          ),
        ),
      ),
    ],
    [
      'air',
      'Air-quality forecast',
      result.environment?.airQuality?.status === 'available'
        ? 'checked'
        : 'unknown',
      result.environment?.airQuality?.note ||
        'No air-quality forecast was collected.',
    ],
  ];
  return groups.map(([id, label, status, detail]) => ({
    id,
    label,
    status,
    detail,
  }));
}
function laneState(lanes) {
  const done = lanes.filter((s) => s.succeeded).length;
  const reports = lanes.reduce((n, s) => n + (s.resultCount || 0), 0);
  return [
    done === lanes.length && done ? 'searched' : done ? 'partial' : 'unknown',
    `${done}/${lanes.length} searches completed; ${reports} leads. Search coverage is not an official all-clear.`,
  ];
}
export function decisionFor(result) {
  const issues = result.issues || [],
    checks = coverageChecks(result);
  const conflicts = issues.some((i) => i.verification?.conflicts?.length);
  const score = Math.max(0, ...issues.map((i) => i.score || 0));
  const unknown = checks
    .filter((c) => c.status === 'unknown')
    .map((c) => c.label);
  return {
    code: conflicts
      ? 'verify'
      : score >= 60
        ? 'review'
        : issues.length
          ? 'precautions'
          : 'routine',
    title: conflicts
      ? 'Verify conflicting reports before departure'
      : score >= 60
        ? 'Review this part of your plan'
        : issues.length
          ? 'Plan around the reported conditions'
          : 'Your plan and next checks are ready',
    detail: issues.length
      ? `${issues.length} report or forecast signal${issues.length === 1 ? '' : 's'} to review. Confirm current applicability with the cited authority or operator.`
      : 'No disruption was established in the information checked. Continue routine checks and review the coverage below.',
    checks,
    gaps: unknown,
    safetyProbability: null,
  };
}
function identity(issue, stop) {
  // Source IDs are local to a scan. URLs and an evidence excerpt identify changes.
  const normalized = normalText(issue.evidence || issue.title)
    .replace(/20\d{2}-\d{2}-\d{2}/g, '')
    .replace(/\b\d+(?:\.\d+)?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return hash(
    `${stop}|${issue.dimension}|${issue.area}|${normalized.slice(0, 350)}`,
  );
}
export function snapshotChanges(
  before,
  after,
  time = new Date().toISOString(),
) {
  const flatten = (snapshot) =>
    (snapshot?.reports || []).flatMap((report) =>
      (report.result?.issues || []).map((issue) => ({
        ...issue,
        stop: report.label,
        result: report.result,
        key: identity(issue, report.key),
      })),
    );
  const previous = new Map(
    [...(before?.pendingSignals || []), ...flatten(before)].map((i) => [
      i.key,
      i,
    ]),
  );
  const current = new Map(flatten(after).map((i) => [i.key, i]));
  const changes = [],
    pending = [];
  for (const [key, issue] of current) {
    const old = previous.get(key);
    if (
      !old ||
      old.notObserved ||
      old.score !== issue.score ||
      old.verification?.label !== issue.verification?.label
    )
      changes.push({
        id: hash(`${time}|${key}|observed`),
        kind: old ? 'changed' : 'new',
        title: issue.title,
        stop: issue.stop,
        at: time,
        detail: old
          ? old.notObserved
            ? 'This signal was observed again after a gap in reporting.'
            : 'The reported severity or source support changed.'
          : 'A report or forecast signal appeared in this check.',
        sourceIds: issue.sourceIds,
        sourceLinks: issue.result.sources
          .filter((s) => issue.sourceIds.includes(s.id))
          .map((s) => ({ title: s.title, url: s.url })),
        read: false,
      });
  }
  for (const [key, issue] of previous)
    if (!current.has(key)) {
      const report = after.reports.find((r) => r.label === issue.stop);
      // A disappearance or provider failure is never proof that an incident cleared.
      const resolved = (report?.result?.resolutions || []).find(
        (r) => overlap(issue.evidence, r.evidence) >= 0.65,
      );
      if (!resolved)
        pending.push({ ...issue, result: undefined, notObserved: true });
      if (issue.notObserved && !resolved) continue;
      changes.push({
        id: hash(`${time}|${key}|missing`),
        kind: resolved ? 'resolved' : 'not-observed',
        title: issue.title,
        stop: issue.stop,
        at: time,
        detail: resolved
          ? 'A current source explicitly reports reopening or withdrawal. Check the original notice.'
          : 'Not observed in this check. It may still apply; this is not confirmation that it cleared.',
        sourceLinks: resolved?.sourceLinks || [],
        read: false,
      });
    }
  if (before && before.coverage !== after.coverage)
    changes.push({
      id: hash(`${time}|coverage`),
      kind: 'coverage',
      title: 'Information coverage changed',
      at: time,
      detail: `Coverage changed from ${before.coverage} to ${after.coverage}.`,
      sourceLinks: [],
      read: false,
    });
  return { events: changes, pending: pending.slice(0, 100) };
}
export function compareSnapshots(before, after, time) {
  return snapshotChanges(before, after, time).events;
}
export function assertedResolution(text) {
  return (
    /\b(roads? reopened|restrictions? lifted|services? resumed|warning withdrawn)\b/i.test(
      text,
    ) &&
    !/\b(no|not|never|false|denied|unconfirmed|expected|will|may|could|planned|likely|if|would|previously)\b|last year/i.test(
      text,
    )
  );
}
export function resolutionReports(sources, now = Date.now()) {
  return sources
    .filter(
      (s) =>
        s.fetched &&
        s.quality?.relevant &&
        publicationDay(s.publishedAt) &&
        now - Date.parse(publicationDay(s.publishedAt)) >= 0 &&
        now - Date.parse(publicationDay(s.publishedAt)) < 2 * DAY,
    )
    .flatMap((s) =>
      String(s.text || '')
        .split(/(?<=[.!?])\s+|\n+/)
        .filter(
          (p) => p.length >= 35 && p.length < 700 && assertedResolution(p),
        )
        .slice(0, 2)
        .map((evidence) => ({
          evidence,
          sourceLinks: [{ title: s.title, url: s.url }],
          publishedAt: s.publishedAt,
        })),
    );
}
export function answerTripQuestion(trip, question) {
  const q = normalText(question),
    latest = trip.latest;
  if (!latest)
    return {
      answer:
        'Run a trip check first. I need retrieved trip evidence to answer this question.',
      citations: [],
      missing: ['No completed trip check.'],
    };
  if (/why|change|clear|yesterday|timeline/.test(q)) {
    const events = (trip.timeline || []).slice(0, 5);
    return {
      answer: events.length
        ? events
            .map((e) => `${e.at.slice(0, 10)}: ${e.title}. ${e.detail}`)
            .join('\n\n')
        : 'No meaningful change has been recorded yet. Another completed check is needed to compare conditions.',
      citations: events.flatMap((e) => e.sourceLinks || []).slice(0, 8),
      missing: [
        'A report disappearing does not establish that a disruption has cleared.',
      ],
    };
  }
  const filter = /bus|road|drive|car|train|flight|transport/.test(q)
    ? (i) =>
        [
          'Infrastructure / Transit',
          'Environmental',
          'Geopolitical & Civil',
        ].includes(i.dimension)
    : /weather|rain|flood|heat|air quality/.test(q)
      ? (i) => i.dimension === 'Environmental'
      : () => true;
  const selected = latest.reports
    .flatMap((r) =>
      (r.result.issues || [])
        .filter(filter)
        .map((issue) => ({ report: r, issue })),
    )
    .slice(0, 5);
  const supported =
    /bus|road|drive|car|train|flight|transport|weather|rain|flood|heat|air quality|check|leav|tomorrow|safe|risk|precaution|child|mobilit|trip|report|source/.test(
      q,
    );
  if (!supported)
    return {
      answer:
        'I can explain this trip’s transport, weather, precautions, sources and recorded changes. The retrieved evidence does not support an answer to that question.',
      citations: [],
      missing: ['This assistant answers from the saved trip evidence only.'],
    };
  const citations = [],
    lines = selected.map(({ report, issue }) => {
      const ids = issue.sourceIds || [];
      const refs = report.result.sources
        .filter((s) => ids.includes(s.id))
        .map((s) => {
          const index = citations.length + 1;
          citations.push({
            title: s.title,
            url: s.url,
            label: `[${index}]`,
            checkedAt: report.result.checkedAt,
          });
          return `[${index}]`;
        });
      return `${report.label}: ${issue.summary || issue.title} ${refs.join(' ')}\n${impactFor(issue, { ...trip.preferences, mode: /bus/.test(q) ? 'bus' : trip.preferences.mode }).join(' ')}`;
    });
  const checks = latest.reports
    .flatMap((r) =>
      (r.result.nextSteps || []).map(
        (s) => `${r.label}: ${s.title} — ${s.detail}`,
      ),
    )
    .slice(0, 4);
  return {
    answer: lines.length
      ? lines.join('\n\n')
      : `No matching disruption was established in the saved evidence. Before leaving:\n${checks.join('\n')}`,
    citations,
    missing: [
      ...new Set(latest.reports.flatMap((r) => r.result.decision?.gaps || [])),
      'No guarantee of safety; check when this briefing was collected.',
    ],
  };
}
