import { SEARCH_CONCURRENCY, MAX_WEB_SOURCES } from './config.js';
import {
  buildQueries,
  searchTinyFish,
  rankAndSelectCandidates,
  sourceRelevanceScore,
  fetchTinyFish,
} from './search.js';
import { fetchOpenMeteoHazards } from './weather.js';
import {
  scoreWithAI,
  ruleBasedAssessment,
  mergeWeatherIssues,
  computeOverallScore,
  riskLevel,
  buildFallbackBriefing,
} from './assessment.js';
import {
  settleWithConcurrency,
  cleanText,
  normalizeUrl,
  safeDomain,
  sourceTrust,
} from './utils.js';
export async function analyzeTrip({ destination, startDate, endDate }) {
  const queryGroups = buildQueries(destination, startDate, endDate);
  const searchStartedAt = Date.now();

  const [searchAttempts, weatherBundle] = await Promise.all([
    settleWithConcurrency(queryGroups, SEARCH_CONCURRENCY, searchTinyFish),
    fetchOpenMeteoHazards(destination, startDate, endDate).catch((error) => {
      console.warn(
        '[TraceRisk] Open-Meteo collection failed:',
        error?.message || error,
      );
      return {
        sources: [],
        issues: [],
        meta: {
          provider: 'Open-Meteo',
          geocoded: false,
          forecastStatus: 'unavailable',
          floodStatus: 'unavailable',
          hasDateRelevantData: false,
          location: null,
          warnings: [
            cleanText(error?.message || 'Weather API unavailable', 240),
          ],
        },
      };
    }),
  ]);

  const searchResults = searchAttempts.flatMap((attempt, index) => {
    if (attempt.status === 'fulfilled') return attempt.value;
    console.warn(
      `[TraceRisk] Search group ${queryGroups[index].id} failed:`,
      attempt.reason?.message || attempt.reason,
    );
    return [];
  });

  const searchMs = Date.now() - searchStartedAt;
  console.log(
    `[TraceRisk] TinyFish returned ${searchResults.length} total search results across ${queryGroups.length} query lanes.`,
  );
  console.log(
    `[TraceRisk] Open-Meteo: forecast=${weatherBundle.meta.forecastStatus}, flood=${weatherBundle.meta.floodStatus}, signals=${weatherBundle.issues.length}.`,
  );

  const candidates = rankAndSelectCandidates(
    searchResults,
    destination,
    MAX_WEB_SOURCES,
  );

  if (!candidates.length && !weatherBundle.sources.length) {
    throw new Error(
      'TraceRisk could not collect usable TinyFish results or date-relevant weather data. Retry shortly; a failed data collection does not mean the destination is safe.',
    );
  }

  const fetchStartedAt = Date.now();
  const fetchOutcome = candidates.length
    ? await fetchTinyFish(candidates)
    : { results: new Map(), errors: [], requestError: null };
  const fetchMs = Date.now() - fetchStartedAt;

  const webSources = candidates.map((candidate, index) => {
    const extracted = fetchOutcome.results.get(normalizeUrl(candidate.url));
    const pageText = cleanText(extracted?.text || '', 4_500);
    return {
      id: `S${index + 1}`,
      title: cleanText(
        extracted?.title ||
          candidate.title ||
          candidate.site_name ||
          'Source result',
        220,
      ),
      url: candidate.url,
      domain: safeDomain(candidate.url),
      snippet: cleanText(candidate.snippet || '', 900),
      text:
        pageText ||
        cleanText(candidate.snippet || candidate.title || '', 4_500),
      fetched: Boolean(pageText),
      group: candidate.group,
      publishedAt: cleanText(
        candidate.date ||
          candidate.publishedAt ||
          candidate.published_at ||
          candidate.published_date ||
          candidate.publication_date ||
          '',
        60,
      ),
      trust: sourceTrust(candidate.url),
    };
  });

  const weatherSources = weatherBundle.sources.map((source) => ({
    ...source,
    fetched: true,
    group: 'weather-api',
  }));
  const sources = [...webSources, ...weatherSources];
  const pagesFetched = webSources.filter((source) => source.fetched).length;
  const sourcesWithRelevantEvidence = webSources.filter(
    (source) => sourceRelevanceScore(source, destination) >= 4,
  ).length;
  console.log(
    `[TraceRisk] Source quality: ${sourcesWithRelevantEvidence}/${webSources.length} web sources look destination/topic-relevant; ${pagesFetched} full pages fetched; ${weatherSources.length} weather API sources added.`,
  );

  const noFullPagesWithoutWeather =
    pagesFetched === 0 && !weatherBundle.meta.hasDateRelevantData;
  if (pagesFetched === 0) {
    console.warn(
      `[TraceRisk] No full webpages were fetched. Continuing with search snippets${weatherBundle.meta.hasDateRelevantData ? ' plus date-relevant weather data' : ''}; scan coverage will be limited or inconclusive.`,
    );
  }

  const succeededLanes = searchAttempts.filter(
    (attempt) => attempt.status === 'fulfilled',
  ).length;
  const laneStats = searchAttempts.map((attempt, index) => ({
    id: queryGroups[index].id,
    label: queryGroups[index].label,
    type: queryGroups[index].domainType,
    searchMode:
      attempt.status === 'fulfilled' &&
      attempt.value.some((item) => item.searchMode === 'broad-fallback')
        ? 'broad-fallback'
        : 'targeted',
    recencyMinutes: queryGroups[index].recencyMinutes || null,
    succeeded: attempt.status === 'fulfilled',
    resultCount: attempt.status === 'fulfilled' ? attempt.value.length : 0,
    selectedCount: candidates.filter(
      (source) => source.group === queryGroups[index].id,
    ).length,
    error:
      attempt.status === 'rejected'
        ? cleanText(attempt.reason?.message || 'search failed', 180)
        : null,
  }));

  const noUsefulWebEvidence =
    webSources.length === 0 ||
    sourcesWithRelevantEvidence === 0 ||
    succeededLanes < 4;

  const coverageStatus = noUsefulWebEvidence
    ? 'inconclusive'
    : noFullPagesWithoutWeather || sourcesWithRelevantEvidence < 2
      ? weatherBundle.meta.hasDateRelevantData
        ? 'limited'
        : 'inconclusive'
      : pagesFetched >= Math.min(6, webSources.length) && succeededLanes >= 6
        ? 'adequate'
        : 'limited';

  const llmStartedAt = Date.now();
  let llmResult = null;
  let llmError = null;

  try {
    llmResult = await scoreWithAI({ destination, startDate, endDate, sources });
    if (llmResult?._fallbackReason) {
      console.warn(
        `[TraceRisk] AI provider sequence: ${llmResult._fallbackReason}`,
      );
    }
  } catch (error) {
    llmError = cleanText(error?.message || 'Unknown AI assessment error', 360);
    console.warn(
      '[TraceRisk] Gemini/Groq assessment unavailable; falling back to rules:',
      llmError,
    );
  }

  const assessmentMs = Date.now() - llmStartedAt;
  const analysisMode = llmResult ? 'llm' : 'rules';
  const assessed =
    llmResult ||
    ruleBasedAssessment({ destination, startDate, endDate, sources });

  const issues = mergeWeatherIssues(
    assessed.issues,
    weatherBundle.issues,
    sources,
  );
  const riskScore = computeOverallScore(issues);
  const hasIssues = issues.length > 0;

  let briefing = hasIssues
    ? cleanText(
        assessed.briefing || buildFallbackBriefing(destination, issues),
        1_000,
      )
    : cleanText(
        assessed.briefing ||
          `No material, destination-specific disruption was identified in the sources reviewed for ${destination} between ${startDate} and ${endDate}. This is not a guarantee of safety.`,
        1_000,
      );

  if (coverageStatus === 'inconclusive') {
    briefing = `INCONCLUSIVE SOURCE COVERAGE: only ${sourcesWithRelevantEvidence} web source(s) looked relevant to ${destination} and ${succeededLanes}/${queryGroups.length} search lanes succeeded; the scan cannot confidently rule out other current disruptions for ${startDate} to ${endDate}. ${briefing}`;
  } else if (coverageStatus === 'limited') {
    briefing = `LIMITED SOURCE COVERAGE: ${pagesFetched} web page(s) were extracted and ${weatherSources.length} weather/flood API source(s) were available. ${briefing} Verify important conditions with official sources before travel.`;
  }

  if (weatherBundle.meta.forecastStatus === 'outside_forecast_window') {
    briefing = `WEATHER FORECAST LIMITATION: Open-Meteo's standard forecast did not cover the selected travel dates. ${briefing}`;
  } else if (weatherBundle.meta.forecastStatus === 'unavailable') {
    briefing = `WEATHER API UNAVAILABLE: no Open-Meteo daily forecast was retrieved for this scan. ${briefing}`;
  }

  if (weatherBundle.meta.warnings?.length) {
    briefing = `${briefing} Weather-data note: ${weatherBundle.meta.warnings.join('; ')}.`;
  }
  if (analysisMode === 'rules') {
    briefing = `RULE-BASED ASSESSMENT (not AI-verified): ${briefing}`;
  }

  return {
    destination,
    startDate,
    endDate,
    riskScore,
    riskLevel: hasIssues
      ? riskLevel(riskScore)
      : coverageStatus === 'inconclusive'
        ? 'Unable to verify'
        : 'No material issues found in reviewed sources',
    hasIssues,
    coverageStatus,
    relevantSources: sourcesWithRelevantEvidence,
    searchLaneStats: laneStats,
    issueCount: issues.length,
    issues,
    sources: sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      domain: source.domain,
      trust: source.trust,
      fetched: source.fetched,
      publishedAt: source.publishedAt || '',
      group: source.group,
      preview: cleanText(source.text || source.snippet || '', 480),
    })),
    briefing,
    searchResultsReturned: searchResults.length,
    sourcesChecked: webSources.length,
    selectedWebSources: candidates.length,
    pagesFetched,
    weatherSourcesChecked: weatherSources.length,
    weather: weatherBundle.meta,
    searchMs,
    fetchMs,
    assessmentMs,
    analysisMode,
    model: llmResult
      ? `${llmResult._providerUsed || 'AI'} · ${llmResult._modelUsed || ''}`.trim()
      : 'rules fallback',
    providerUsed: llmResult?._providerUsed || 'Rules',
    providerFallbackReason: llmResult?._fallbackReason || null,
    sourceHealth: {
      searchGroupsSucceeded: succeededLanes,
      searchGroupsTried: queryGroups.length,
      selectedWebSources: candidates.length,
      relevantWebSources: sourcesWithRelevantEvidence,
      searchLanes: laneStats,
      pagesFetched,
      fetchErrorCount: fetchOutcome.errors.length,
      fetchRequestError: fetchOutcome.requestError,
      llmError,
      llmFallbackReason: llmResult?._fallbackReason || null,
      weatherApi: weatherBundle.meta,
    },
    disclaimer:
      'Weather forecast signals are model-derived, not official warnings. TraceRisk is an experimental travel-awareness tool, not an official safety rating. Confirm important information with local authorities and transport operators.',
  };
}
