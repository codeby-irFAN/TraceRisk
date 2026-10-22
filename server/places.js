import { fetchJson } from './http.js';
import { cleanText, trimCache } from './utils.js';
const catalog = [
  {
    name: 'Hawa Mahal',
    aliases: ['hawa mahal', 'palace of winds'],
    city: 'Jaipur',
    admin1: 'Rajasthan',
    latitude: 26.923936,
    longitude: 75.826743,
  },
  {
    name: 'Qutub Minar',
    aliases: ['qutub minar', 'qutb minar', 'qutub complex', 'qutb complex'],
    city: 'Delhi',
    admin1: 'Delhi',
    latitude: 28.524428,
    longitude: 77.185456,
  },
  {
    name: 'Taj Mahal',
    aliases: ['taj mahal'],
    city: 'Agra',
    admin1: 'Uttar Pradesh',
    latitude: 27.175015,
    longitude: 78.042155,
  },
  {
    name: 'Amber Fort',
    aliases: ['amber fort', 'amer fort'],
    city: 'Jaipur',
    admin1: 'Rajasthan',
    latitude: 26.985771,
    longitude: 75.851303,
  },
  {
    name: 'India Gate',
    aliases: ['india gate'],
    city: 'Delhi',
    admin1: 'Delhi',
    latitude: 28.612912,
    longitude: 77.22951,
  },
  {
    name: 'Gateway of India',
    aliases: ['gateway of india'],
    city: 'Mumbai',
    admin1: 'Maharashtra',
    latitude: 18.921984,
    longitude: 72.834654,
  },
];
const normal = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const cache = new Map();
export function knownLandmarks(query) {
  const q = normal(query);
  return catalog
    .filter((p) =>
      p.aliases.some((alias) => {
        const city = normal(p.city),
          state = normal(p.admin1);
        const qualifiers = [
          '',
          city,
          state,
          `${city} ${state}`,
          `${city} india`,
          `${city} ${state} india`,
          'india',
          ...(p.city === 'Delhi' ? ['new delhi', 'new delhi india'] : []),
        ];
        return qualifiers.some(
          (suffix) => q === `${alias}${suffix ? ' ' + suffix : ''}`,
        );
      }),
    )
    .map(({ aliases, ...p }) => ({
      ...p,
      kind: 'landmark',
      country: 'India',
      provenance:
        'TraceRisk landmark directory; coordinates identify the attraction, not an incident',
    }));
}
export function photonPlaces(data) {
  const unique = new Map();
  for (const feature of (data?.features || []).slice(0, 20)) {
    const p = feature.properties || {},
      c = feature.geometry?.coordinates;
    if (
      String(p.countrycode || '').toUpperCase() !== 'IN' ||
      !p.name ||
      !Array.isArray(c) ||
      !Number.isFinite(c[0]) ||
      !Number.isFinite(c[1]) ||
      Math.abs(c[0]) > 180 ||
      Math.abs(c[1]) > 90
    )
      continue;
    const city = cleanText(p.city || p.district || p.county || '', 100);
    const landmark =
      !['city', 'town', 'village', 'municipality', 'state', 'county'].includes(
        p.osm_value,
      ) && Boolean(city);
    const value = {
      name: cleanText(p.name, 100),
      city: landmark ? city : '',
      admin1: cleanText(p.state || '', 100),
      admin2: cleanText(p.county || '', 100),
      country: 'India',
      latitude: c[1],
      longitude: c[0],
      kind: landmark ? 'landmark' : 'city',
      provenance: 'OpenStreetMap via Photon',
    };
    unique.set(`${value.name}|${c[0]}|${c[1]}`, value);
  }
  return [...unique.values()].slice(0, 8);
}
export async function findSpecificPlaces(query) {
  const known = knownLandmarks(query);
  if (known.length) return known;
  const key = normal(query),
    hit = cache.get(key);
  if (hit && Date.now() - hit.time < 3600000) return hit.places;
  const url = new URL(
    '/api/',
    process.env.PLACE_SEARCH_URL || 'https://photon.komoot.io',
  );
  url.search = new URLSearchParams({
    q: `${query} India`,
    limit: '8',
    lang: 'en',
  }).toString();
  const data = await fetchJson(
    url,
    {
      headers: {
        'User-Agent':
          'TraceRisk/5.1 (https://github.com/codeby-irFAN/TraceRisk)',
      },
    },
    3000,
  );
  const places = photonPlaces(data);
  cache.set(key, { time: Date.now(), places });
  trimCache(cache, 300);
  return places;
}
