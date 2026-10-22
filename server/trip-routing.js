import {
  fetchJson,
  withRequestBudget,
  createConcurrencyGate,
  sleep,
} from './http.js';
import { distanceKm } from './environment.js';
import { cleanText, trimCache } from './utils.js';

const routesCache = new Map(),
  placesCache = new Map();
const reverseGate = createConcurrencyGate(1, 12);
let lastReverse = 0;
const publicBase = (setting, fallback) => {
  const url = new URL(process.env[setting] || fallback);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid route-service configuration.');
  return url;
};
export function routeSample(coordinates, fraction) {
  const point = ([longitude, latitude]) => ({ latitude, longitude });
  const segments = coordinates
    .slice(1)
    .map((c, i) => distanceKm(point(coordinates[i]), point(c)));
  const target = segments.reduce((sum, d) => sum + d, 0) * fraction;
  let elapsed = 0;
  for (let i = 0; i < segments.length; i++) {
    if (elapsed + segments[i] >= target) {
      const t = segments[i] ? (target - elapsed) / segments[i] : 0;
      return {
        longitude:
          coordinates[i][0] + (coordinates[i + 1][0] - coordinates[i][0]) * t,
        latitude:
          coordinates[i][1] + (coordinates[i + 1][1] - coordinates[i][1]) * t,
      };
    }
    elapsed += segments[i];
  }
  return point(coordinates.at(-1));
}
async function reversePlace(point) {
  const key = `${point.latitude.toFixed(2)},${point.longitude.toFixed(2)}`;
  if (placesCache.has(key)) return { ...placesCache.get(key), ...point };
  return withRequestBudget(
    () =>
      reverseGate(async () => {
        if (Date.now() - lastReverse < 1100)
          await sleep(1100 - (Date.now() - lastReverse));
        lastReverse = Date.now();
        const url = new URL(
          '/reverse',
          publicBase(
            'REVERSE_GEOCODING_URL',
            'https://nominatim.openstreetmap.org',
          ),
        );
        url.search = new URLSearchParams({
          lat: String(point.latitude),
          lon: String(point.longitude),
          format: 'jsonv2',
          zoom: '10',
          'accept-language': 'en',
        }).toString();
        const data = await fetchJson(
          url,
          {
            headers: {
              'User-Agent':
                'TraceRisk/5.0 (https://github.com/codeby-irFAN/TraceRisk)',
            },
          },
          3000,
        );
        const address = data?.address;
        if (address?.country_code !== 'in') return null;
        const name =
          address.city || address.town || address.village || address.county;
        if (!name || !address.state) return null;
        const place = {
          name: cleanText(name, 100),
          admin1: cleanText(address.state, 100),
          country: 'India',
          ...point,
          provenance:
            'Route checkpoint named with OpenStreetMap reverse geocoding',
        };
        placesCache.set(key, place);
        trimCache(placesCache, 300);
        return place;
      }),
    6000,
    'Route checkpoint lookup timed out.',
  );
}
export async function getTripRoutes(trip) {
  const points = [trip.origin, ...trip.stops.map((s) => s.location)].filter(
    Boolean,
  );
  const empty = {
    status: 'unavailable',
    routes: [],
    checkpoints: [],
    checkedAt: new Date().toISOString(),
    notes: [],
  };
  if (points.length < 2)
    return {
      ...empty,
      status: 'not-requested',
      notes: ['Add an origin or another stop to check a route.'],
    };
  if (!['car', 'bus', 'motorcycle'].includes(trip.preferences.mode))
    return {
      ...empty,
      status: 'unsupported-mode',
      notes: [
        'Map markers show your stops. Train and flight routes and schedules must be checked with your operator.',
      ],
    };
  const key = JSON.stringify(points.map((p) => [p.longitude, p.latitude]));
  if (routesCache.has(key) && Date.now() - routesCache.get(key).time < 1800000)
    return routesCache.get(key).value;
  try {
    const coordinates = points
      .map((p) => `${p.longitude},${p.latitude}`)
      .join(';');
    const url = new URL(
      `/route/v1/driving/${coordinates}`,
      publicBase('ROUTING_BASE_URL', 'https://router.project-osrm.org'),
    );
    url.search = new URLSearchParams({
      alternatives: points.length === 2 ? 'true' : 'false',
      geometries: 'geojson',
      overview: 'full',
      steps: 'true',
    }).toString();
    const data = await fetchJson(url, { maxResponseBytes: 2000000 }, 5000);
    if (
      data.code !== 'Ok' ||
      !Array.isArray(data.routes) ||
      !data.routes.length
    )
      throw new Error('No supported road route was returned.');
    const routes = data.routes.slice(0, 3).flatMap((r, index) => {
      const coords = r.geometry?.coordinates;
      if (
        !Array.isArray(coords) ||
        coords.length < 2 ||
        coords.some(
          (p) =>
            !Array.isArray(p) ||
            !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1]) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 90,
        ) ||
        !Number.isFinite(r.distance) ||
        !Number.isFinite(r.duration)
      )
        return [];
      const stride = Math.max(1, Math.ceil(coords.length / 2500));
      const reduced = coords.filter((_, i) => i % stride === 0);
      if (reduced.at(-1) !== coords.at(-1)) reduced.push(coords.at(-1));
      return [
        {
          id: `route-${index}`,
          label: index ? `Road option ${index + 1}` : 'Main road option',
          distanceKm: Math.round(r.distance / 1000),
          durationMinutes: Math.round(r.duration / 60),
          coordinates: reduced,
          roadNames: [
            ...new Set(
              (r.legs || []).flatMap((l) =>
                (l.steps || []).flatMap((s) => [s.name, s.ref].filter(Boolean)),
              ),
            ),
          ].slice(0, 60),
          legDistancesKm: (r.legs || []).map((l) => Number(l.distance) / 1000),
          sourceUrl: url.href,
          checkpoints: [],
        },
      ];
    });
    if (!routes.length) throw new Error('Route geometry could not be read.');
    const value = {
      status: 'available',
      routes,
      checkedAt: new Date().toISOString(),
      notes: [
        'Road geometry and driving-time estimates from OSRM/OpenStreetMap. Estimates exclude live traffic, closures, stops and bus schedules.',
        'Only supported event coordinates are plotted as incident points. Other reports remain in the regional list.',
      ],
      attribution: '© OpenStreetMap contributors; routing by OSRM',
    };
    routesCache.set(key, { value, time: Date.now() });
    trimCache(routesCache, 100);
    return value;
  } catch (error) {
    return {
      ...empty,
      notes: [
        `Road route unavailable: ${cleanText(error.message, 140)}`,
        'Your stops and destination checks remain available. No road geometry or travel time is invented.',
      ],
    };
  }
}
export async function getRouteCheckpoints(route, trip) {
  if (!route || route.distanceKm < 100) return [];
  const points = [trip.origin, ...trip.stops.map((s) => s.location)].filter(
    Boolean,
  );
  const distances = route.legDistancesKm || [];
  const total = distances.reduce((n, d) => n + d, 0);
  const legFor = (fraction) => {
    let passed = 0;
    for (let i = 0; i < distances.length; i++) {
      passed += distances[i];
      if (fraction * total <= passed) return i;
    }
    return 0;
  };
  const candidates = [0.33, 0.66]
    .map((fraction) => {
      const leg = legFor(fraction);
      const departure = trip.origin
        ? leg === 0
          ? trip.stops[0].startDate
          : trip.stops[leg - 1]?.endDate
        : trip.stops[leg]?.endDate;
      const arrival = trip.stops[trip.origin ? leg : leg + 1]?.startDate;
      return {
        ...routeSample(route.coordinates, fraction),
        startDate: departure || trip.stops[0].startDate,
        endDate: arrival || departure || trip.stops[0].startDate,
        legIndex: leg,
      };
    })
    .filter((p) => points.every((stop) => distanceKm(p, stop) > 35));
  const result = [];
  for (const point of candidates) {
    try {
      const place = await reversePlace(point);
      if (
        place &&
        !result.some((p) => p.name === place.name && p.admin1 === place.admin1)
      )
        result.push({
          ...place,
          startDate: point.startDate,
          endDate: point.endDate,
          legIndex: point.legIndex,
        });
    } catch {
      /* A missing checkpoint must not prevent endpoint analysis. */
    }
  }
  return result;
}
