import assert from 'node:assert/strict';
import test from 'node:test';
import { isDate, normalizeUrl, sourceTrust } from '../server/utils.js';
import { mergeWeatherIssues, normalizeIssues } from '../server/assessment.js';

test('dates must be complete ISO calendar dates', () => {
  assert.equal(isDate('2028-02-29'), true);
  for (const value of [
    '2026-02-29',
    '2026-02-30',
    '2026-10-22junk',
    '22-10-2026',
    null,
    ['2026-10-22'],
  ]) {
    assert.equal(isDate(value), false);
  }
});

test('source URLs reject unsupported schemes and embedded credentials', () => {
  assert.equal(
    normalizeUrl('https://example.com/news/#section'),
    'https://example.com/news',
  );
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  for (const url of [
    'javascript:alert(1)',
    'ftp://example.com',
    'https://user:pass@example.com',
    {},
    null,
  ]) {
    assert.equal(normalizeUrl(url), '');
  }
});

test('source trust matches whole hostnames', () => {
  assert.equal(sourceTrust('https://mausam.imd.gov.in'), 'Official government');
  assert.equal(sourceTrust('https://delhi.nic.in'), 'Official government');
  assert.equal(sourceTrust('https://www.thehindu.com/news'), 'News outlet');
  assert.equal(sourceTrust('https://thehindu.com.example.org'), 'Web source');
  assert.equal(sourceTrust('https://not-twitter.com'), 'Web source');
});

test('issues require valid citations and keep the strongest duplicate', () => {
  const issue = {
    title: 'Closure',
    area: 'Delhi',
    dimension: 'Infrastructure / Transit',
    sourceIds: ['S1'],
    score: 40,
  };
  const issues = normalizeIssues(
    [
      issue,
      {
        ...issue,
        score: 70,
        confidence: null,
        sourceIds: ['S1', 'S1', 'made-up'],
      },
      { ...issue, title: 'Unsupported', sourceIds: ['made-up'], score: 100 },
      null,
    ],
    [{ id: 'S1' }],
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].score, 70);
  assert.equal(issues[0].confidence, 0.45);
  assert.deepEqual(issues[0].sourceIds, ['S1']);
});

test('invalid or weaker AI issues cannot suppress a deterministic forecast signal', () => {
  const forecast = {
    title: 'Heavy rainfall forecast signal',
    dimension: 'Environmental',
    score: 68,
    sourceIds: ['W1'],
  };
  for (const score of [0, 30]) {
    const issues = mergeWeatherIssues(
      [{ ...forecast, title: 'Rain expected', score }],
      [forecast],
      [{ id: 'W1' }],
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].score, 68);
    assert.equal(issues[0].title, forecast.title);
  }
});
