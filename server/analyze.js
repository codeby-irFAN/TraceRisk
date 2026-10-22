import { performance } from 'node:perf_hooks';
import {
  MAX_WEB_SOURCES,
  SCAN_STAGES,
  REQUEST_BUDGET_MS,
  ENGINE_VERSION,
} from './config.js';
import {
  buildQueries,
  searchTinyFish,
  rankAndSelectCandidates,
  fetchTinyFish,
} from './search.js';
import { fetchOpenMeteoHazards } from './weather.js';
import {
  scoreWithAI,
  mergeWeatherIssues,
  computeOverallScore,
  riskLevel,
} from './assessment.js';
import {
  publicSource,
  placeContext,
  deterministicClaims,
  verifyClaims,
  buildLeads,
  publisherKey,
} from './evidence.js';
import { withRequestBudget, currentSignal } from './http.js';
import { cleanText, summarizeForecastCoverage } from './utils.js';

function emptyWeather(trip, error) {
  return {
    sources: [],
    issues: [],
    meta: {
      provider: 'Open-Meteo',
      geocoded: Boolean(trip.location),
      location: trip.location || null,
      forecastStatus: 'unavailable',
      floodStatus: 'unavailable',
      dailyForecast: [],
      riverFlow: [],
      hasDateRelevantData: false,
      ...summarizeForecastCoverage(trip.startDate, trip.endDate, []),
      warnings: [error || 'Weather data is unavailable.'],
    },
  };
}
function weatherSummary(weather) {
  const rows = weather.dailyForecast || [];
  const temps = rows
    .flatMap((r) => [r.minC, r.maxC])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return rows.length
    ? `${weather.forecastDaysMatched} of ${weather.tripDays} trip days have a forecast${temps.length ? `; temperatures range from ${Math.min(...temps).toFixed(0)}°C to ${Math.max(...temps).toFixed(0)}°C` : ''}.`
    : 'Daily forecasts do not cover the selected trip yet, or the provider is unavailable. Recheck closer to departure.';
}

export function createAnalyzer({
  search = searchTinyFish,
  extract = fetchTinyFish,
  weather = fetchOpenMeteoHazards,
  assess = scoreWithAI,
  stages = SCAN_STAGES,
  now = Date.now,
} = {}) {
  return async (trip) =>
    withRequestBudget(
      async () => {
        const started = performance.now(),
          collectedAt = now();
        const context = placeContext(trip.destination, trip.location);
        const parent = currentSignal();
        const timings = {};
        const stage = async (name, ms, task) => {
          const start = performance.now();
          try {
            const value = await withRequestBudget(
              task,
              ms,
              `${name} exceeded its stage budget.`,
            );
            timings[name] = {
              status: 'complete',
              durationMs: Math.round(performance.now() - start),
            };
            return { status: 'fulfilled', value };
          } catch (error) {
            parent?.throwIfAborted();
            timings[name] = {
              status: error.name === 'TimeoutError' ? 'timeout' : 'failed',
              durationMs: Math.round(performance.now() - start),
            };
            return { status: 'rejected', reason: error };
          }
        };

        // Weather never blocks search or extraction. Each lane and batch is bounded.
        const weatherPromise = stage('weather', stages.weather, () =>
          weather(
            trip.destination,
            trip.startDate,
            trip.endDate,
            trip.location,
          ),
        );
        weatherPromise.catch(() => {});
        const groups = buildQueries(
          trip.destination,
          trip.startDate,
          trip.endDate,
          trip.location,
        );
        const searchStart = performance.now();
        const searches = await Promise.all(
          groups.map((group) =>
            stage(`search:${group.id}`, stages.search, () => search(group)),
          ),
        );
        const searchMs = Math.round(performance.now() - searchStart);
        const rows = searches.flatMap((r) =>
          r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [],
        );
        const candidates = rankAndSelectCandidates(
          rows,
          trip.destination,
          MAX_WEB_SOURCES,
          trip.location,
          collectedAt,
        );
        const extraction = candidates.length
          ? await stage('extraction', stages.extraction, () =>
              extract(candidates),
            )
          : {
              status: 'fulfilled',
              value: { results: new Map(), errors: [], requestError: null },
            };
        const fetched =
          extraction.status === 'fulfilled'
            ? extraction.value
            : {
                results: new Map(),
                errors: candidates.map((s) => ({
                  url: s.url,
                  error: 'Extraction did not finish in time.',
                })),
                requestError: cleanText(extraction.reason.message, 180),
              };
        const web = candidates.map((s, i) =>
          publicSource(s, fetched.results.get(s.url), i, context, now()),
        );
        const weatherOutcome = await weatherPromise;
        const weatherBundle =
          weatherOutcome.status === 'fulfilled'
            ? weatherOutcome.value
            : emptyWeather(trip, cleanText(weatherOutcome.reason.message, 180));
        const sources = [...web, ...weatherBundle.sources];
        const assessment = web.some((s) => s.fetched && s.quality.relevant)
          ? await stage('assessment', stages.assessment, () =>
              assess({ ...trip, sources: web }),
            )
          : { status: 'fulfilled', value: null };
        const ai = assessment.status === 'fulfilled' ? assessment.value : null;
        const verified = verifyClaims(
          [...(ai?.claims || []), ...deterministicClaims(web, context)],
          web,
          trip,
          collectedAt,
        );
        const issues = mergeWeatherIssues(
          verified.issues,
          weatherBundle.issues,
          sources,
        );
        const leads = buildLeads(web, issues, context);
        const relevant = web.filter((s) => s.quality.relevant);
        const currentPages = relevant.filter(
          (s) => s.fetched && s.quality.recency === 'recent',
        );
        const publishers = new Set(currentPages.map((s) => publisherKey(s.url)))
          .size;
        const distinctDocuments = new Set(
          currentPages.map((s) => s.contentHash),
        ).size;
        const succeeded = searches.filter(
          (s) => s.status === 'fulfilled',
        ).length;
        const populated = searches.filter(
          (s) => s.status === 'fulfilled' && s.value.length,
        ).length;
        const coverageStatus =
          currentPages.length >= 4 &&
          publishers >= 3 &&
          distinctDocuments >= 3 &&
          succeeded >= 6 &&
          populated >= 4
            ? 'adequate'
            : relevant.length
              ? 'limited'
              : 'inconclusive';
        const pagesFetched = web.filter((s) => s.fetched).length;
        const laneStats = groups.map((group, i) => ({
          id: group.id,
          label: group.label,
          type: group.domainType,
          recencyMinutes: group.recencyMinutes,
          succeeded: searches[i].status === 'fulfilled',
          resultCount: searches[i].value?.length || 0,
          selectedCount: candidates.filter((s) => s.groups.includes(group.id))
            .length,
          searchMode:
            searches[i].value?.searchMode ||
            searches[i].value?.[0]?.searchMode ||
            'targeted',
          error:
            searches[i].status === 'rejected'
              ? cleanText(searches[i].reason.message, 160)
              : null,
          durationMs: timings[`search:${group.id}`].durationMs,
        }));
        const resultStatus =
          coverageStatus === 'adequate'
            ? 'complete'
            : sources.length
              ? 'partial'
              : 'unavailable';
        const summary = issues.length
          ? `${issues.length} source-supported report(s) or forecast signal(s) need attention.`
          : leads.length
            ? `${leads.length} local source(s) are available to review; no disruption met the evidence checks for this trip.`
            : 'No current disruption could be established from the evidence available in this scan.';
        const briefing = `${trip.destination}: ${summary} ${weatherSummary(weatherBundle.meta)} ${coverageStatus === 'adequate' ? 'Several current publications were collected; coverage is not exhaustive.' : `Web coverage is ${coverageStatus}: ${relevant.length} relevant source(s), ${pagesFetched} opened page(s).`} Confirm conditions close to departure.`;
        const nextSteps = [
          {
            title: 'Check official weather warnings',
            url: 'https://mausam.imd.gov.in/',
            detail: 'Review IMD warnings for the destination and travel dates.',
          },
          {
            title: 'Confirm transport and local access',
            url: 'https://enquiry.indianrail.gov.in/mntes/',
            detail:
              'Check your operator and local police updates before departure; this link covers Indian Railways train enquiries.',
          },
        ];
        if (relevant.some((s) => s.trust === 'Official government')) {
          const official = relevant.find(
            (s) => s.trust === 'Official government',
          );
          nextSteps.unshift({
            title: 'Read the local official source',
            url: official.url,
            detail:
              'Verify its issue date, location and whether the notice is still active.',
          });
        }
        const riskScore = computeOverallScore(issues);
        return {
          engineVersion: ENGINE_VERSION,
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          resultStatus,
          coverageStatus,
          briefing,
          hasIssues: issues.length > 0,
          issueCount: issues.length,
          issues,
          leads,
          nextSteps,
          riskScore,
          riskLevel: issues.length
            ? riskLevel(riskScore)
            : coverageStatus === 'inconclusive'
              ? 'Unable to verify'
              : 'No supported disruption identified',
          scoreMeaning:
            'Highest evidence-backed signal severity; not a probability of harm.',
          highlights: [
            {
              title: 'Local information',
              detail: `${relevant.length} relevant web source(s); ${leads.length} additional source(s) to review.`,
            },
            {
              title: 'Weather for your dates',
              detail: weatherSummary(weatherBundle.meta),
            },
            {
              title: 'What to do next',
              detail:
                'Read the cited evidence and confirm official warnings and transport status before travelling.',
            },
          ],
          relevantSources: relevant.length,
          sources: sources.map(({ text, snippet, ...source }) => ({
            ...source,
            preview: cleanText(text || snippet, 480),
          })),
          searchLaneStats: laneStats,
          searchResultsReturned: rows.length,
          sourcesChecked: web.length,
          selectedWebSources: candidates.length,
          pagesFetched,
          weatherSourcesChecked: weatherBundle.sources.length,
          weather: weatherBundle.meta,
          searchMs,
          fetchMs: timings.extraction?.durationMs || 0,
          assessmentMs: timings.assessment?.durationMs || 0,
          analysisMode: ai ? 'llm' : 'rules',
          model: ai
            ? `${ai._providerUsed} · ${ai._modelUsed}`
            : 'Evidence checks',
          providerUsed: ai ? ai._providerUsed : 'Rules',
          providerFallbackReason: ai?._fallbackReason || null,
          sourceHealth: {
            searchGroupsSucceeded: succeeded,
            searchGroupsTried: groups.length,
            selectedWebSources: web.length,
            relevantWebSources: relevant.length,
            searchLanes: laneStats,
            pagesFetched,
            publisherCount: publishers,
            distinctDocumentCount: distinctDocuments,
            fetchErrorCount: fetched.errors.length,
            fetchRequestError: fetched.requestError,
            llmError:
              assessment.status === 'rejected'
                ? cleanText(assessment.reason.message, 240)
                : null,
            llmFallbackReason: ai?._fallbackReason || null,
            rejectedClaimCount: verified.rejectedCount,
            weatherApi: weatherBundle.meta,
          },
          performance: {
            budgetMs: REQUEST_BUDGET_MS,
            elapsedMs: Math.round(performance.now() - started),
            stages: timings,
          },
          collectedAt: new Date(collectedAt).toISOString(),
          disclaimer:
            'TraceRisk provides travel information, not an official safety rating or a guarantee of safety. Source quotations are checked against retrieved text, not independently fact-checked. Weather signals are model-derived; confirm important decisions with authorities and operators.',
        };
      },
      REQUEST_BUDGET_MS - 500,
      'The scan could not finish within its processing budget.',
    );
}
export const analyzeTrip = createAnalyzer();
