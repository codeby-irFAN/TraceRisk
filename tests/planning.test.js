import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBriefing,
  datePreset,
  restorePlan,
  savePlan,
  tripDays,
  validPlans,
} from '../src/planning.js';

test('date shortcuts respect weekends and roll into the next month', () => {
  assert.deepEqual(datePreset('weekend', '2026-10-30'), {
    startDate: '2026-10-31',
    endDate: '2026-11-01',
  });
  assert.deepEqual(datePreset('next-week', '2026-11-02'), {
    startDate: '2026-11-09',
    endDate: '2026-11-13',
  });
  assert.equal(tripDays('2028-02-28', '2028-03-01'), 3);
  assert.equal(tripDays('2026-02-30', '2026-03-04'), 0);
});

test('saved plans contain trip details only, deduplicate and keep six entries', () => {
  const plan = {
    destination: ' Delhi ',
    startDate: '2026-10-22',
    endDate: '2026-10-25',
    locationId: 'expired-server-token',
    riskScore: 5,
    briefing: 'Old result',
  };
  let plans = savePlan([], plan);
  plans = savePlan(plans, { ...plan, destination: 'Delhi' });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].locationId, undefined);
  assert.equal(plans[0].riskScore, undefined);
  assert.equal(validPlans(plans), true);
  for (let index = 0; index < 8; index++)
    plans = savePlan(plans, { ...plan, destination: `City ${index}` });
  assert.equal(plans.length, 6);
  assert.equal(plans[0].destination, 'City 7');
  assert.equal(
    validPlans([{ ...plan, id: 'bad', startDate: 'invalid' }]),
    false,
  );
});

test('restoring an old plan preserves its duration with fresh travel dates', () => {
  const plan = {
    destination: 'Delhi',
    startDate: '2026-01-01',
    endDate: '2026-01-04',
  };
  const restored = restorePlan(plan, '2026-10-21');
  assert.equal(restored.startDate, '2026-10-21');
  assert.equal(restored.endDate, '2026-10-24');
  assert.equal(restored.adjusted, true);
});

test('downloaded briefings retain limitations, full evidence and missing forecast dates', () => {
  const text = buildBriefing({
    destination: 'Delhi',
    startDate: '2026-10-22',
    endDate: '2026-10-25',
    coverageStatus: 'inconclusive',
    analysisMode: 'rules',
    briefing: 'Insufficient coverage.',
    issues: [],
    sources: [
      {
        id: 'S1',
        title: 'Advisory',
        url: 'https://example.gov.in',
        fetched: false,
      },
    ],
    weather: {
      tripDays: 4,
      forecastDaysMatched: 2,
      forecastMissingDateRanges: [{ start: '2026-10-24', end: '2026-10-25' }],
    },
  });
  assert.match(text, /Source coverage: inconclusive/);
  assert.match(text, /Daily forecast coverage: 2 of 4/);
  assert.match(text, /2026-10-24 to 2026-10-25/);
  assert.match(text, /Snippet only/);
  assert.match(text, /not a guarantee of safety/);
  assert.match(text, /https:\/\/example.gov.in/);
});
