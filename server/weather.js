import {
  OPEN_METEO_FORECAST,
  OPEN_METEO_FLOOD,
  OPEN_METEO_TIMEOUT_MS,
} from './config.js';
import { openMeteoJson } from './open-meteo.js';
import { findDestinationLocations } from './locations.js';
import { cleanText, summarizeForecastCoverage } from './utils.js';

export async function fetchOpenMeteoHazards(
  destination,
  startDate,
  endDate,
  confirmedLocation,
) {
  const meta = {
    provider: 'Open-Meteo',
    apiKeyRequired: false,
    geocoded: false,
    location: null,
    forecastStatus: 'unavailable',
    floodStatus: 'unavailable',
    forecastWindow: null,
    ...summarizeForecastCoverage(startDate, endDate, []),
    floodDaysMatched: 0,
    dailyForecast: [],
    riverFlow: [],
    hasDateRelevantData: false,
    weatherSignals: 0,
    warnings: [],
    note: 'Open-Meteo forecast/flood outputs are model signals, not official meteorological warnings.',
  };

  const place =
    confirmedLocation ||
    (await findDestinationLocations(destination)
      .then((places) => places[0])
      .catch((error) => {
        meta.warnings.push(
          `Geocoding failed: ${cleanText(error?.message || 'unknown error', 180)}`,
        );
        return null;
      }));

  if (!place) {
    meta.warnings.push(
      'The destination could not be resolved to a location for the weather API.',
    );
    return { sources: [], issues: [], meta };
  }

  meta.geocoded = true;
  meta.location = {
    name: place.name,
    admin1: place.admin1 || '',
    country: place.country || 'India',
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone || '',
  };

  const forecastUrl = new URL(OPEN_METEO_FORECAST);
  forecastUrl.searchParams.set('latitude', String(place.latitude));
  forecastUrl.searchParams.set('longitude', String(place.longitude));
  forecastUrl.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,snowfall_sum',
  );
  forecastUrl.searchParams.set('forecast_days', '16');
  forecastUrl.searchParams.set('timezone', 'auto');
  forecastUrl.searchParams.set('temperature_unit', 'celsius');
  forecastUrl.searchParams.set('wind_speed_unit', 'kmh');
  forecastUrl.searchParams.set('precipitation_unit', 'mm');

  const floodUrl = new URL(OPEN_METEO_FLOOD);
  floodUrl.searchParams.set('latitude', String(place.latitude));
  floodUrl.searchParams.set('longitude', String(place.longitude));
  floodUrl.searchParams.set(
    'daily',
    'river_discharge,river_discharge_mean,river_discharge_max',
  );
  floodUrl.searchParams.set('forecast_days', '210');
  floodUrl.searchParams.set('timezone', 'auto');

  const [forecastAttempt, floodAttempt] = await Promise.allSettled([
    openMeteoJson(
      forecastUrl,
      {
        headers: { 'User-Agent': 'TraceRisk-App/4.0.0' },
      },
      OPEN_METEO_TIMEOUT_MS,
    ),

    openMeteoJson(
      floodUrl,
      {
        headers: { 'User-Agent': 'TraceRisk-App/4.0.0' },
      },
      OPEN_METEO_TIMEOUT_MS,
    ),
  ]);

  const sources = [];
  const issues = [];
  const displayLocation = [place.name, place.admin1, place.country || 'India']
    .filter((part, index, list) => part && list.indexOf(part) === index)
    .join(', ');

  if (forecastAttempt.status === 'fulfilled') {
    const response = forecastAttempt.value;
    const daily = response?.daily || {};
    const times = Array.isArray(daily.time) ? daily.time : [];

    const matchingDays = times
      .map((date, index) => ({ date, index }))
      .filter(
        ({ date, index }) =>
          date >= startDate &&
          date <= endDate &&
          Object.entries(daily).some(
            ([key, values]) =>
              key !== 'time' && valueAt(values, index) !== null,
          ),
      );

    meta.forecastWindow = times.length
      ? { start: times[0], end: times[times.length - 1] }
      : null;
    Object.assign(
      meta,
      summarizeForecastCoverage(
        startDate,
        endDate,
        matchingDays.map((day) => day.date),
      ),
    );
    if (meta.forecastCoverage === 'partial') {
      meta.warnings.push(
        `Daily forecasts cover only ${meta.forecastDaysMatched} of ${meta.tripDays} trip days. Conditions on the remaining dates are unknown.`,
      );
    }

    if (matchingDays.length) {
      meta.forecastStatus = 'available';
      const records = matchingDays.map(({ date, index }) => ({
        date,
        weatherCode: valueAt(daily.weather_code, index),
        condition: describeWmoCode(valueAt(daily.weather_code, index)),
        maxC: valueAt(daily.temperature_2m_max, index),
        minC: valueAt(daily.temperature_2m_min, index),
        precipitationMm: valueAt(daily.precipitation_sum, index),
        precipitationProbabilityPct: valueAt(
          daily.precipitation_probability_max,
          index,
        ),
        maxWindKmh: valueAt(daily.wind_speed_10m_max, index),
        maxGustKmh: valueAt(daily.wind_gusts_10m_max, index),
        snowfallCm: valueAt(daily.snowfall_sum, index),
      }));

      meta.dailyForecast = records;

      const forecastText = [
        `Provider: Open-Meteo Forecast API (weather-model output, not an official warning).`,
        `Resolved destination: ${displayLocation}.`,
        `Requested trip: ${startDate} to ${endDate}.`,
        `Forecast days matched to trip window: ${matchingDays.length}.`,
        `Forecast data: ${JSON.stringify(records)}.`,
        `Screening note: precipitation/wind/temperature thresholds are approximate triage signals only; they are not official alerts and can miss local hazards.`,
      ].join('\n');

      const forecastSource = {
        id: 'W1',
        title: `Open-Meteo daily weather forecast — ${displayLocation}`,
        url: forecastUrl.toString(),
        domain: 'open-meteo.com',
        snippet: cleanText(
          `${matchingDays.length} daily forecast record(s) for ${displayLocation} during ${startDate} to ${endDate}.`,
          700,
        ),
        text: cleanText(forecastText, 8500),
        fetched: true,
        group: 'weather-api',
        publishedAt: response._traceRiskRetrievedAt || new Date().toISOString(),
        trust: 'Weather forecast API (model-derived)',
        dateRelevant: true,
      };

      sources.push(forecastSource);
      issues.push(
        ...deriveForecastIssues(records, displayLocation, forecastSource.id),
      );
      meta.hasDateRelevantData = true;
      meta.weatherSignals += issues.length;
    } else {
      meta.forecastStatus =
        times.some((date) => date >= startDate && date <= endDate) ||
        !times.length
          ? 'unavailable'
          : 'outside_forecast_window';
      meta.warnings.push(
        meta.forecastStatus === 'unavailable'
          ? 'Open-Meteo returned no usable daily forecast measurements for the selected trip.'
          : `The standard Open-Meteo forecast covers ${times[0] || 'an unavailable start'} to ${times[times.length - 1] || 'an unavailable end'}, not the selected trip dates. Its standard forecast horizon is up to 16 days.`,
      );
    }
  } else {
    meta.forecastStatus = 'unavailable';
    meta.warnings.push(
      `Open-Meteo forecast request failed: ${cleanText(forecastAttempt.reason?.message || 'unknown error', 180)}`,
    );
  }

  if (floodAttempt.status === 'fulfilled') {
    const response = floodAttempt.value;
    const daily = response?.daily || {};
    const times = Array.isArray(daily.time) ? daily.time : [];
    const matchingDays = times
      .map((date, index) => ({
        date,
        discharge: valueAt(daily.river_discharge, index),
        mean: valueAt(daily.river_discharge_mean, index),
        max: valueAt(daily.river_discharge_max, index),
      }))
      .filter((item) => item.date >= startDate && item.date <= endDate);

    const validDays = matchingDays.filter(
      (item) =>
        Number.isFinite(item.discharge) ||
        Number.isFinite(item.mean) ||
        Number.isFinite(item.max),
    );
    meta.floodDaysMatched = validDays.length;

    if (validDays.length) {
      meta.floodStatus = 'available';
      meta.riverFlow = validDays;
      const floodText = [
        `Provider: Open-Meteo Flood API (modelled river-discharge forecast; not an official flood warning).`,
        `Resolved destination: ${displayLocation}.`,
        `Requested trip: ${startDate} to ${endDate}.`,
        `The API's nearest model river-grid-cell coordinates are ${response.latitude ?? place.latitude}, ${response.longitude ?? place.longitude}; this cell may not represent the exact destination or a particular local river.`,
        `River discharge records in m³/s: ${JSON.stringify(validDays)}.`,
        `Caution: discharge values alone do not prove that flooding or road inundation will occur; interpret rising trends as an early signal only.`,
      ].join('\n');

      const floodSource = {
        id: 'W2',
        title: `Open-Meteo river-discharge forecast — ${displayLocation}`,
        url: floodUrl.toString(),
        domain: 'open-meteo.com',
        snippet: cleanText(
          `${validDays.length} river-discharge forecast record(s) matched the trip window; these are model data, not an official flood warning.`,
          700,
        ),
        text: cleanText(floodText, 8500),
        fetched: true,
        group: 'weather-api',
        publishedAt: response._traceRiskRetrievedAt || new Date().toISOString(),
        trust: 'Flood forecast API (model-derived)',
        dateRelevant: true,
      };

      sources.push(floodSource);
      const riverIssue = deriveRiverFlowIssue(
        validDays,
        displayLocation,
        floodSource.id,
      );
      if (riverIssue) {
        issues.push(riverIssue);
        meta.weatherSignals += 1;
      }
      meta.hasDateRelevantData = true;
    } else {
      meta.floodStatus = 'no_data_for_trip';
      meta.warnings.push(
        'The Open-Meteo Flood API returned no river-discharge values for the selected travel dates/location.',
      );
    }
  } else {
    meta.floodStatus = 'unavailable';
    meta.warnings.push(
      `Open-Meteo Flood API request failed: ${cleanText(floodAttempt.reason?.message || 'unknown error', 180)}`,
    );
  }

  if (
    meta.forecastStatus === 'unavailable' &&
    meta.floodStatus === 'unavailable'
  ) {
    meta.warnings.push(
      'Neither Open-Meteo API returned usable data for this scan.',
    );
  }

  console.log(
    `[TraceRisk] Open-Meteo resolved ${displayLocation}; daily forecast days=${meta.forecastDaysMatched}; flood days=${meta.floodDaysMatched}; generated weather signals=${issues.length}.`,
  );

  return { sources, issues, meta };
}

function valueAt(array, index) {
  if (!Array.isArray(array)) return null;
  const value = array[index];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function deriveForecastIssues(records, location, sourceId) {
  const issues = [];
  const add = (issue) =>
    issues.push({
      confidence: 0.48,
      area: location,
      sourceIds: [sourceId],
      ...issue,
    });
  const formatDates = (rows) => rows.map((row) => row.date).join(', ');

  const rainy = records.filter((row) => Number(row.precipitationMm) >= 25);
  if (rainy.length) {
    const max = Math.max(...rainy.map((row) => Number(row.precipitationMm)));
    const severe = max >= 50;
    add({
      title: severe
        ? 'Heavy rainfall forecast signal'
        : 'Elevated rainfall forecast signal',
      dimension: 'Environmental',
      severity: severe ? 'high' : 'moderate',
      score: severe ? 68 : 50,
      summary: `Open-Meteo forecasts up to ${max.toFixed(1)} mm of daily precipitation in ${location} during ${formatDates(rainy)}. This is a forecast-derived screening signal, not an official weather warning.`,
      travelerImpact:
        'Heavy rain can reduce visibility and disrupt road access; check local IMD warnings, river levels and transport updates before travel.',
      evidence: `Open-Meteo daily precipitation: ${rainy.map((row) => `${row.date}=${row.precipitationMm} mm (precipitation chance ${row.precipitationProbabilityPct == null ? 'not supplied' : `${row.precipitationProbabilityPct}%`})`).join('; ')}.`,
    });
  }

  const windy = records.filter((row) => Number(row.maxGustKmh) >= 55);
  if (windy.length) {
    const max = Math.max(...windy.map((row) => Number(row.maxGustKmh)));
    const severe = max >= 75;
    add({
      title: severe
        ? 'Strong wind gust forecast signal'
        : 'Elevated wind gust forecast signal',
      dimension: 'Environmental',
      severity: severe ? 'high' : 'moderate',
      score: severe ? 66 : 47,
      summary: `Open-Meteo forecasts maximum gusts up to ${max.toFixed(0)} km/h in ${location} on ${formatDates(windy)}. This is not an official warning.`,
      travelerImpact:
        'Strong gusts may affect exposed roads, outdoor activities and transport; check official advisories close to departure.',
      evidence: `Forecast maximum wind gusts: ${windy.map((row) => `${row.date}=${row.maxGustKmh} km/h`).join('; ')}.`,
    });
  }

  const hot = records.filter((row) => Number(row.maxC) >= 38);
  if (hot.length) {
    const max = Math.max(...hot.map((row) => Number(row.maxC)));
    const severe = max >= 40;
    add({
      title: severe
        ? 'High-heat forecast signal'
        : 'Elevated-heat forecast signal',
      dimension: 'Environmental',
      severity: severe ? 'high' : 'moderate',
      score: severe ? 64 : 46,
      summary: `Open-Meteo forecasts maximum temperatures up to ${max.toFixed(1)}°C in ${location} on ${formatDates(hot)}. These are broad screening thresholds, not an official heatwave classification.`,
      travelerImpact:
        'Plan hydration and shade breaks, especially for outdoor travel, and check local heat advisories.',
      evidence: `Forecast maximum temperature: ${hot.map((row) => `${row.date}=${row.maxC}°C`).join('; ')}.`,
    });
  }

  const snowy = records.filter((row) => Number(row.snowfallCm) >= 5);
  if (snowy.length) {
    const max = Math.max(...snowy.map((row) => Number(row.snowfallCm)));
    const severe = max >= 10;
    add({
      title: severe
        ? 'Heavy snowfall forecast signal'
        : 'Snowfall forecast signal',
      dimension: 'Environmental',
      severity: severe ? 'high' : 'moderate',
      score: severe ? 67 : 49,
      summary: `Open-Meteo forecasts snowfall up to ${max.toFixed(1)} cm in ${location} on ${formatDates(snowy)}. This does not confirm road closure or avalanche danger.`,
      travelerImpact:
        'Snow can affect mountain roads and access; verify road status and official local advisories before departure.',
      evidence: `Forecast snowfall: ${snowy.map((row) => `${row.date}=${row.snowfallCm} cm`).join('; ')}.`,
    });
  }

  const stormy = records.filter((row) =>
    [95, 96, 99].includes(Number(row.weatherCode)),
  );
  if (stormy.length) {
    add({
      title: 'Thunderstorm forecast signal',
      dimension: 'Environmental',
      severity: stormy.some((row) => [96, 99].includes(Number(row.weatherCode)))
        ? 'high'
        : 'moderate',
      score: stormy.some((row) => [96, 99].includes(Number(row.weatherCode)))
        ? 63
        : 49,
      summary: `Open-Meteo indicates thunderstorm conditions for ${location} on ${formatDates(stormy)}. The forecast code is a model signal, not an official alert.`,
      travelerImpact:
        'Thunderstorms may disrupt outdoor plans and increase local travel hazards; check IMD updates and transport status.',
      evidence: `WMO forecast codes: ${stormy.map((row) => `${row.date}=${row.weatherCode} (${row.condition})`).join('; ')}.`,
    });
  }

  return issues;
}

export function deriveRiverFlowIssue(records, location, sourceId) {
  const values = records
    .map((row) => ({
      date: row.date,
      value: row.discharge ?? row.mean ?? row.max,
    }))
    .filter((row) => Number.isFinite(row.value) && row.value >= 0);

  if (values.length < 2) return null;

  const first = values[0];
  const last = values[values.length - 1];
  const increase = last.value - first.value;
  const pct = first.value > 0 ? (increase / first.value) * 100 : null;

  if (!(increase > 5 && (pct === null ? last.value > 10 : pct >= 60)))
    return null;

  return {
    title: 'River-discharge forecast rising near destination',
    dimension: 'Environmental',
    severity: 'moderate',
    score: 48,
    confidence: 0.32,
    area: location,
    summary: `Open-Meteo's nearest river-grid forecast rises from ${first.value.toFixed(1)} to ${last.value.toFixed(1)} m³/s between ${first.date} and ${last.date}. This is an early model signal only, not a flood warning; the grid cell may be outside the exact itinerary.`,
    travelerImpact:
      'If travelling near rivers or low-lying roads, check official flood bulletins and local road conditions before departure.',
    evidence: `River-discharge model values: ${first.date}=${first.value} m³/s; ${last.date}=${last.value} m³/s${pct === null ? '' : ` (${pct.toFixed(0)}% increase)`}.`,
    sourceIds: [sourceId],
  };
}

function describeWmoCode(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return 'weather condition not supplied';
  }
  const descriptions = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snowfall',
    73: 'moderate snowfall',
    75: 'heavy snowfall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with hail',
    99: 'thunderstorm with heavy hail',
  };
  return descriptions[Number(value)] || 'weather condition not described';
}
