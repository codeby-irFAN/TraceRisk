import { localDate, plusDays, prettyDate } from './utils.js';

export const CHECKLIST = [
  { id: 'transport', label: 'Confirm transport & accommodation' },
  { id: 'advisories', label: 'Recheck official local advisories' },
  { id: 'contacts', label: 'Save emergency contacts offline' },
];

function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00`)) &&
    localDate(new Date(`${value}T12:00:00`)) === value
  );
}

export function validPlans(value) {
  return (
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every(
      (plan) =>
        plan &&
        typeof plan.id === 'string' &&
        typeof plan.destination === 'string' &&
        plan.destination.trim().length >= 2 &&
        plan.destination.length <= 90 &&
        validDate(plan.startDate) &&
        validDate(plan.endDate) &&
        plan.startDate <= plan.endDate,
    )
  );
}

export function tripDays(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate)
    return 0;
  return (
    Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

export function datePreset(kind, today) {
  const weekday = new Date(`${today}T12:00:00`).getDay();
  if (kind === 'weekend') {
    const startDate = plusDays(today, (6 - weekday + 7) % 7);
    return { startDate, endDate: plusDays(startDate, 1) };
  }
  if (kind === 'next-week') {
    const startDate = plusDays(today, (8 - weekday) % 7 || 7);
    return { startDate, endDate: plusDays(startDate, 4) };
  }
  return { startDate: today, endDate: plusDays(today, 2) };
}

export function savePlan(plans, plan) {
  const next = {
    destination: plan.destination.trim(),
    startDate: plan.startDate,
    endDate: plan.endDate,
  };
  next.id = JSON.stringify([
    next.destination.toLocaleLowerCase('en-IN'),
    next.startDate,
    next.endDate,
  ]);
  return [next, ...plans.filter((entry) => entry.id !== next.id)].slice(0, 6);
}

export function restorePlan(plan, today) {
  if (plan.startDate >= today) return { ...plan, adjusted: false };
  return {
    ...plan,
    startDate: today,
    endDate: plusDays(
      today,
      Math.max(0, tripDays(plan.startDate, plan.endDate) - 1),
    ),
    adjusted: true,
  };
}

export function buildBriefing(result) {
  const lines = [
    'TRACERISK · TRAVEL BRIEFING',
    result.destination,
    `${prettyDate(result.startDate)} – ${prettyDate(result.endDate)}`,
    `Checked: ${result.checkedAt || 'Not supplied'}`,
    `Source coverage: ${result.coverageStatus || 'inconclusive'}`,
    `Review: ${result.analysisMode === 'llm' ? result.model || 'AI-assisted' : 'Rules-based; not AI-verified'}`,
    '',
    result.briefing || 'Review source coverage before making travel decisions.',
  ];
  if (result.weather?.tripDays != null) {
    lines.push(
      '',
      `Daily forecast coverage: ${result.weather.forecastDaysMatched || 0} of ${result.weather.tripDays} trip days`,
    );
    for (const range of result.weather.forecastMissingDateRanges || [])
      lines.push(`No daily forecast: ${range.start} to ${range.end}`);
  }
  lines.push('', 'SIGNALS');
  if (!result.issues?.length)
    lines.push(
      'No issues crossed the screening threshold. This is not a guarantee of safety.',
    );
  for (const issue of result.issues || []) {
    lines.push(
      '',
      `${issue.title} · ${issue.severity} · ${issue.score}/100`,
      issue.summary || '',
      issue.travelerImpact || '',
      `Sources: ${(issue.sourceIds || []).join(', ')}`,
    );
  }
  lines.push('', 'REVIEWED SOURCES');
  for (const source of result.sources || [])
    lines.push(
      `[${source.id}] ${source.title || source.domain}\n${source.url}\n${source.group === 'weather-api' ? 'Forecast model data' : source.fetched ? 'Page opened' : 'Snippet only'} · ${source.publishedAt || 'Date unknown'}`,
    );
  lines.push(
    '',
    result.disclaimer ||
      'TraceRisk is an experimental travel-awareness tool, not an official safety rating. Confirm important information with local authorities. Forecast signals are model-derived, not official warnings.',
  );
  return lines.filter((line) => line !== undefined).join('\n');
}
