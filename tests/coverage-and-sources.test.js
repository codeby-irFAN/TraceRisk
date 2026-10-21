import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeForecastCoverage } from '../server/utils.js';
import { getSourceBadges } from '../src/utils.js';

test('forecast coverage identifies missing days and gaps across month boundaries', () => {
  const coverage = summarizeForecastCoverage('2026-10-30', '2026-11-03', [
    '2026-10-30',
    '2026-11-01',
    '2026-11-01',
    '2026-11-02',
    '2026-11-20',
  ]);
  assert.equal(coverage.tripDays, 5);
  assert.equal(coverage.forecastDaysMatched, 3);
  assert.equal(coverage.forecastCoverage, 'partial');
  assert.deepEqual(coverage.forecastMissingDateRanges, [
    { start: '2026-10-31', end: '2026-10-31' },
    { start: '2026-11-03', end: '2026-11-03' },
  ]);
  assert.equal(
    summarizeForecastCoverage('2028-02-28', '2028-03-01', []).tripDays,
    3,
  );
  assert.equal(
    summarizeForecastCoverage('2026-10-21', '2026-10-21', ['2026-10-21'])
      .forecastCoverage,
    'complete',
  );
});

test('missing weather coverage is represented without generating millions of dates', () => {
  const coverage = summarizeForecastCoverage('0001-01-01', '9999-12-31', []);
  assert.equal(coverage.forecastCoverage, 'unavailable');
  assert.deepEqual(coverage.forecastMissingDateRanges, [
    { start: '0001-01-01', end: '9999-12-31' },
  ]);
});

test('source badges distinguish government, snippets, old reports and model retrieval dates', () => {
  const checkedAt = '2026-10-21T12:00:00Z';
  const old = getSourceBadges(
    { trust: 'Official government', publishedAt: '2026-01-01', fetched: false },
    checkedAt,
  ).map((badge) => badge.label);
  assert.ok(old.includes('Government source'));
  assert.ok(old.includes('Snippet only'));
  assert.ok(old.includes('Older report'));
  assert.ok(old.some((label) => label.startsWith('Published')));
  const model = getSourceBadges(
    { group: 'weather-api', publishedAt: '2026-10-21' },
    checkedAt,
  ).map((badge) => badge.label);
  assert.ok(model.includes('Forecast model'));
  assert.ok(model.some((label) => label.startsWith('Retrieved')));
  assert.ok(!model.some((label) => label.startsWith('Published')));
  assert.ok(
    getSourceBadges({ publishedAt: 'not-a-date' }, checkedAt).some(
      (badge) => badge.label === 'Publication date unknown',
    ),
  );
});
