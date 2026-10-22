import { XMLParser } from 'fast-xml-parser';
import { fetchJson, withRequestBudget, currentSignal } from './http.js';
import { normalizeUrl, cleanText } from './utils.js';

export function distanceKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - Math.min(1, h)));
}
const value = (v) => (typeof v === 'object' ? v?.['#text'] : v);
export function parseDisasterFeed(xml, location, startDate, endDate) {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(xml);
  const data = parsed?.rss?.channel?.item;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.slice(0, 500).flatMap((item) => {
    const level = String(value(item['gdacs:alertlevel']) || '').toLowerCase();
    const latitude = Number(item['geo:Point']?.['geo:lat']),
      longitude = Number(item['geo:Point']?.['geo:long']);
    const from = Date.parse(value(item['gdacs:fromdate']) || item.pubDate),
      to = Date.parse(value(item['gdacs:todate']) || item.pubDate);
    const url = normalizeUrl(item.link);
    if (
      !['orange', 'red'].includes(level) ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      !url ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return [];
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    if (
      day(from) > endDate ||
      day(to) < startDate ||
      distanceKm(location, { latitude, longitude }) > 150
    )
      return [];
    return [
      {
        title: cleanText(item.title, 220),
        url,
        level,
        latitude,
        longitude,
        startDate: day(from),
        endDate: day(to),
        distanceKm: Math.round(distanceKm(location, { latitude, longitude })),
      },
    ];
  });
}
let disasterCache;
async function getDisasters() {
  if (disasterCache && Date.now() - disasterCache.time < 900000)
    return disasterCache;
  return withRequestBudget(
    async () => {
      const response = await fetch('https://www.gdacs.org/xml/rss.xml', {
        signal: currentSignal(),
        headers: {
          'User-Agent':
            'TraceRisk/5.0 (travel-information; source links retained)',
        },
      });
      if (!response.ok)
        throw new Error(`Disaster feed returned HTTP ${response.status}.`);
      const reader = response.body.getReader();
      let length = 0;
      const parts = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > 2000000) throw new Error('Disaster feed is too large.');
          parts.push(Buffer.from(chunk.value));
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      disasterCache = {
        xml: Buffer.concat(parts).toString('utf8'),
        time: Date.now(),
      };
      return disasterCache;
    },
    4000,
    'Disaster feed did not respond in time.',
  );
}
export async function fetchEnvironmentalContext(trip) {
  const sources = [],
    issues = [],
    meta = {
      airQuality: {
        status: 'unavailable',
        days: [],
        note: 'Air-quality data is unavailable.',
      },
      disasters: {
        status: 'unavailable',
        note: 'Regional disaster alerts could not be checked.',
      },
    };
  if (!trip.location) return { sources, issues, meta };
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.search = new URLSearchParams({
    latitude: String(trip.location.latitude),
    longitude: String(trip.location.longitude),
    hourly: 'us_aqi,pm2_5',
    forecast_days: '5',
    timezone: 'auto',
  }).toString();
  const outcomes = await Promise.allSettled([
    fetchJson(url, {}, 4000),
    getDisasters(),
  ]);
  currentSignal()?.throwIfAborted();
  const checkedAt = new Date().toISOString();
  if (outcomes[0].status === 'fulfilled') {
    const hourly = outcomes[0].value?.hourly || {},
      days = new Map();
    (hourly.time || []).slice(0, 168).forEach((time, index) => {
      const day = String(time).slice(0, 10),
        aqi = hourly.us_aqi?.[index];
      if (
        day < trip.startDate ||
        day > trip.endDate ||
        typeof aqi !== 'number' ||
        !Number.isFinite(aqi)
      )
        return;
      const current = days.get(day) || { date: day, usAqi: 0, pm25: null };
      current.usAqi = Math.max(current.usAqi, aqi);
      const pm = hourly.pm2_5?.[index];
      if (typeof pm === 'number' && Number.isFinite(pm))
        current.pm25 = Math.max(current.pm25 || 0, pm);
      days.set(day, current);
    });
    meta.airQuality = {
      status: days.size ? 'available' : 'outside-window',
      days: [...days.values()],
      note: days.size
        ? `${days.size} trip day(s) have a modelled air-quality forecast. US AQI scale; not a CPCB station observation.`
        : 'The five-day air-quality forecast does not cover these dates.',
    };
    if (days.size) {
      const text = [...days.values()]
        .map((d) => `${d.date}: forecast maximum US AQI ${d.usAqi}.`)
        .join(' ');
      sources.push({
        id: 'A1',
        title: 'Open-Meteo / CAMS air-quality forecast',
        url: url.href,
        domain: 'air-quality-api.open-meteo.com',
        group: 'air-quality-api',
        trust: 'Air-quality model',
        fetched: true,
        publishedAt: checkedAt,
        retrievedAt: checkedAt,
        text,
      });
      const worst = Math.max(...[...days.values()].map((d) => d.usAqi));
      if (worst >= 151)
        issues.push({
          id: 'air-quality',
          title: 'Unhealthy air-quality forecast',
          dimension: 'Environmental',
          area: trip.location.name,
          score: worst >= 201 ? 65 : 50,
          confidence: 0.6,
          evidenceStatus: 'Model forecast',
          dateBasis: 'Forecast records inside the trip window',
          summary: `The model forecasts a maximum US AQI of ${worst} during the covered trip dates.`,
          evidence: text,
          travelerImpact:
            'Check local air-quality observations before outdoor activity, particularly for children and people with respiratory needs.',
          sourceIds: ['A1'],
        });
    }
  }
  if (outcomes[1].status === 'fulfilled') {
    const feed = outcomes[1].value;
    try {
      const events = parseDisasterFeed(
        feed.xml,
        trip.location,
        trip.startDate,
        trip.endDate,
      );
      meta.disasters = {
        status: 'checked',
        count: events.length,
        retrievedAt: new Date(feed.time).toISOString(),
        note: 'GDACS orange/red events within 150 km whose reported dates overlap the trip. This is not exhaustive local hazard coverage.',
      };
      for (const [index, event] of events.slice(0, 5).entries()) {
        const id = `D${index + 1}`,
          evidence = `${event.title}. GDACS ${event.level} alert, ${event.startDate} to ${event.endDate}; reported event point ${event.distanceKm} km from the checked location.`;
        sources.push({
          id,
          title: event.title,
          url: event.url,
          domain: new URL(event.url).hostname,
          group: 'disaster-api',
          trust: 'GDACS disaster alert',
          fetched: true,
          publishedAt: event.startDate,
          retrievedAt: new Date(feed.time).toISOString(),
          text: evidence,
        });
        issues.push({
          id: `disaster-${index}`,
          title: 'Regional disaster alert to review',
          dimension: 'Environmental',
          area: `Within 150 km of ${trip.location.name}`,
          score: event.level === 'red' ? 75 : 55,
          confidence: 0.7,
          evidenceStatus: 'Structured disaster alert',
          dateBasis: 'explicit-trip-dates',
          summary: evidence,
          evidence,
          travelerImpact:
            'Review the event’s actual affected area with local authorities; proximity to an event point does not prove local impact.',
          sourceIds: [id],
          coordinates: {
            latitude: event.latitude,
            longitude: event.longitude,
            basis:
              'GDACS reported event point; affected area may extend beyond it.',
          },
        });
      }
    } catch {
      meta.disasters.note = 'The disaster feed format could not be read.';
    }
  }
  return { sources, issues, meta };
}
