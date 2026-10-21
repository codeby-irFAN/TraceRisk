import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchOpenMeteoHazards } from '../server/weather.js';
import { geocodeScore } from '../server/locations.js';

test('geocoding honours the explicitly requested state', () => {
  const query = 'rampur';
  const requested = {
    name: 'Rampur',
    admin1: 'Himachal Pradesh',
    country_code: 'IN',
  };
  const other = {
    name: 'Rampur',
    admin1: 'Uttar Pradesh',
    country_code: 'IN',
    population: 300000,
  };
  assert.ok(
    geocodeScore(requested, query, 'himachal pradesh') >
      geocodeScore(other, query, 'himachal pradesh'),
  );
});

test('weather collection never substitutes dates outside the trip', async (t) => {
  const requested = [];
  const mock = t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.hostname.startsWith('geocoding-api'))
      return Response.json({
        results: [
          {
            name: 'Delhi',
            country_code: 'IN',
            latitude: 28.61,
            longitude: 77.21,
          },
        ],
      });
    if (url.hostname.startsWith('flood-api'))
      return Response.json({
        daily: { time: ['2026-10-22'], river_discharge: [null] },
      });
    return Response.json({
      daily: {
        time: ['2026-10-22', '2026-10-23'],
        temperature_2m_max: [30, 42],
        precipitation_sum: [0, 80],
        weather_code: [0, 99],
      },
    });
  });
  t.after(() => mock.mock.restore());

  const outside = await fetchOpenMeteoHazards(
    'Delhi',
    '2027-01-01',
    '2027-01-02',
  );
  assert.equal(outside.meta.forecastStatus, 'outside_forecast_window');
  assert.equal(outside.meta.forecastDaysMatched, 0);
  assert.equal(outside.meta.hasDateRelevantData, false);
  assert.equal(outside.sources.length, 0);
  assert.equal(outside.issues.length, 0);

  const matching = await fetchOpenMeteoHazards(
    'Delhi',
    '2026-10-22',
    '2026-10-22',
  );
  assert.equal(matching.meta.forecastStatus, 'available');
  assert.deepEqual(
    matching.meta.dailyForecast.map((day) => day.date),
    ['2026-10-22'],
  );
  assert.equal(matching.meta.hasDateRelevantData, true);
  assert.equal(matching.issues.length, 0);
  assert.equal(matching.meta.floodStatus, 'no_data_for_trip');

  const geocodingRequests = requested.filter((url) =>
    url.hostname.startsWith('geocoding-api'),
  ).length;
  const partial = await fetchOpenMeteoHazards(
    'Rampur',
    '2026-10-22',
    '2026-10-25',
    {
      name: 'Rampur',
      admin1: 'Himachal Pradesh',
      country: 'India',
      latitude: 31.4,
      longitude: 77.6,
    },
  );
  assert.equal(partial.meta.tripDays, 4);
  assert.equal(partial.meta.forecastCoverage, 'partial');
  assert.equal(partial.meta.forecastDaysMatched, 2);
  assert.deepEqual(partial.meta.forecastMissingDateRanges, [
    { start: '2026-10-24', end: '2026-10-25' },
  ]);
  assert.equal(partial.meta.location.admin1, 'Himachal Pradesh');
  assert.equal(
    requested.filter((url) => url.hostname.startsWith('geocoding-api')).length,
    geocodingRequests,
  );
  assert.ok(
    requested.some(
      (url) =>
        url.hostname === 'api.open-meteo.com' &&
        url.searchParams.get('latitude') === '31.4',
    ),
  );
});
