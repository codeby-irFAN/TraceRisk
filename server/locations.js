import { findSpecificPlaces, knownLandmarks } from './places.js';
import { randomUUID } from 'node:crypto';
import { OPEN_METEO_GEOCODING, GEOCODING_TIMEOUT_MS } from './config.js';
import { openMeteoJson } from './open-meteo.js';
import { cleanText } from './utils.js';

export function normalizeDestination(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('en-IN')
    .replace(/\s+/g, ' ');
}

export function locationLabel(place) {
  return [
    ...new Set(
      [
        place.name,
        place.city,
        place.admin2,
        place.admin1,
        place.country,
      ].filter(Boolean),
    ),
  ].join(', ');
}

export function createLocationResolver({
  search = findDestinationLocations,
  now = Date.now,
  ttlMs = 10 * 60_000,
  maxEntries = 1000,
} = {}) {
  const choices = new Map();
  return {
    async resolve(destination) {
      const places = (await search(destination)).slice(
        0,
        Math.min(8, maxEntries),
      );
      const time = now();
      for (const [id, entry] of choices)
        if (entry.expiresAt <= time) choices.delete(id);
      while (choices.size + places.length > maxEntries && choices.size)
        choices.delete(choices.keys().next().value);
      return places.map((place) => {
        const choice = {
          ...place,
          id: randomUUID(),
          label: locationLabel(place),
        };
        choices.set(choice.id, {
          choice,
          destination: normalizeDestination(destination),
          expiresAt: time + ttlMs,
        });
        return choice;
      });
    },
    get(id, destination) {
      const entry = choices.get(id);
      if (
        !entry ||
        entry.expiresAt <= now() ||
        entry.destination !== normalizeDestination(destination)
      )
        return null;
      return entry.choice;
    },
  };
}

export async function findDestinationLocations(destination) {
  const known = knownLandmarks(destination);
  if (known.length) return known;
  // Start landmark lookup concurrently; city geocoding alone cannot find attractions.
  const specific = findSpecificPlaces(destination).catch(() => []);

  const variants = [
    ...new Set(
      [destination.trim(), destination.split(',')[0].trim()].filter(Boolean),
    ),
  ];
  let lastError = null;

  for (const name of variants) {
    const url = new URL(OPEN_METEO_GEOCODING);
    url.searchParams.set('name', name);
    url.searchParams.set('count', '10');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    url.searchParams.set('countryCode', 'IN');

    try {
      const data = await openMeteoJson(
        url,
        {
          headers: { 'User-Agent': 'TraceRisk-App/4.0.0' },
        },
        GEOCODING_TIMEOUT_MS,
      );
      const results = Array.isArray(data?.results) ? data.results : [];
      if (!results.length) continue;

      const normalizedQuery = normalizePlaceName(name);
      const region = normalizePlaceName(
        destination.split(',').slice(1).join(' '),
      );
      results.sort(
        (a, b) =>
          geocodeScore(b, normalizedQuery, region) -
          geocodeScore(a, normalizedQuery, region),
      );
      const unique = new Map();
      for (const item of results) {
        if (
          String(item.country_code || '').toUpperCase() !== 'IN' ||
          typeof item.latitude !== 'number' ||
          typeof item.longitude !== 'number' ||
          !Number.isFinite(item.latitude) ||
          !Number.isFinite(item.longitude) ||
          Math.abs(item.latitude) > 90 ||
          Math.abs(item.longitude) > 180 ||
          !item.name
        )
          continue;
        const key = `${item.latitude}|${item.longitude}|${item.name}`;
        if (!unique.has(key))
          unique.set(key, {
            name: cleanText(item.name, 100),
            admin1: cleanText(item.admin1 || '', 100),
            admin2: cleanText(item.admin2 || '', 100),
            country: 'India',
            latitude: item.latitude,
            longitude: item.longitude,
            timezone: item.timezone || '',
          });
      }
      if (unique.size) {
        const landmarks = await specific;
        return [
          ...landmarks.filter((p) => p.kind === 'landmark'),
          ...unique.values(),
        ].slice(0, 8);
      }
    } catch (error) {
      lastError = error;
    }
  }

  const places = await specific;
  if (places.length) return places;
  if (lastError) throw lastError;
  return [];
}

export function geocodeScore(result, normalizedQuery, region = '') {
  let score = 0;
  const name = normalizePlaceName(result?.name || '');
  const admin1 = normalizePlaceName(result?.admin1 || '');
  const admin2 = normalizePlaceName(result?.admin2 || '');
  const country = String(result?.country_code || '').toUpperCase();

  if (country === 'IN') score += 100;
  if (region && (admin1 === region || admin2 === region)) score += 120;
  if (name === normalizedQuery) score += 100;
  if (admin1 === normalizedQuery || admin2 === normalizedQuery) score += 80;
  if (
    name &&
    normalizedQuery &&
    (name.includes(normalizedQuery) || normalizedQuery.includes(name))
  )
    score += 25;
  if (/^(ADM1|ADM2|ADM3|PPLA|PPLA2|PPLC)$/i.test(result?.feature_code || ''))
    score += 10;
  if (Number(result?.population) > 100_000) score += 5;
  return score;
}

function normalizePlaceName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
