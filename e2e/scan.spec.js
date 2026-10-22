import { test, expect } from '@playwright/test';
import { localDate, plusDays, prettyDate } from '../src/utils.js';
import { readFile } from 'node:fs/promises';

const tomorrow = plusDays(localDate(new Date()), 1);
const tripEnd = plusDays(tomorrow, 3);

const locations = [
  { id: 'up', label: 'Rampur, Uttar Pradesh, India' },
  { id: 'hp', label: 'Rampur, Himachal Pradesh, India' },
];
const fixture = {
  destination: locations[1].label,
  startDate: tomorrow,
  endDate: tripEnd,
  checkedAt: new Date().toISOString(),
  hasIssues: true,
  riskLevel: 'High',
  riskScore: 68,
  coverageStatus: 'limited',
  analysisMode: 'rules',
  issueCount: 1,
  briefing:
    'Partial weather coverage. Confirm official advisories before travel.',
  issues: [
    {
      id: 'rain',
      title: 'Heavy rainfall forecast signal',
      dimension: 'Environmental',
      severity: 'high',
      score: 68,
      confidence: 0.48,
      sourceIds: ['S1'],
    },
  ],
  sources: [
    {
      id: 'S1',
      title: 'District weather advisory',
      domain: 'example.gov.in',
      url: 'https://example.gov.in/advisory',
      trust: 'Official government',
      fetched: false,
      publishedAt: '2026-01-01',
      group: 'official-advisories',
    },
  ],
  weather: {
    location: { name: 'Rampur', admin1: 'Himachal Pradesh', country: 'India' },
    tripDays: 4,
    forecastDaysMatched: 2,
    forecastCoverage: 'partial',
    forecastStatus: 'available',
    forecastMissingDateRanges: [{ start: plusDays(tomorrow, 2), end: tripEnd }],
    dailyForecast: [
      { date: tomorrow, maxC: 30, minC: 22, precipitationMm: 60 },
    ],
  },
};

async function chooseDestination(page) {
  await page.goto('/');
  await page.getByLabel('WHERE ARE YOU GOING?').fill('Rampur');
  await page.getByLabel('Travel start date').fill(tomorrow);
  await page.getByLabel('Travel end date').fill(tripEnd);
  await page.getByRole('button', { name: 'Find destination' }).click();
  await expect(
    page.getByRole('group', { name: 'Confirm your destination' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeDisabled();
  await page.getByRole('radio', { name: locations[1].label }).check();
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.abort(),
  );
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, tinyfishConfigured: true } }),
  );
  await page.route('**/api/locations?*', (route) =>
    route.fulfill({ json: { locations } }),
  );
});

test('a sparse scan still provides useful source leads and next checks without alerts', async ({
  page,
}) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        hasIssues: false,
        issues: [],
        issueCount: 0,
        riskScore: 0,
        resultStatus: 'partial',
        riskLevel: 'No supported disruption identified',
        highlights: [
          {
            title: 'Local information',
            detail: 'One source needs a current-status check.',
          },
        ],
        leads: [
          {
            id: 'lead-S1',
            title: 'Local travel notice',
            sourceIds: ['S1'],
            excerpt: 'Check the district notice before travelling.',
            status: 'Source to review',
            reason: 'Only a search snippet was available.',
          },
        ],
        nextSteps: [
          {
            title: 'Check official weather warnings',
            url: 'https://mausam.imd.gov.in/',
            detail: 'Review IMD warnings.',
          },
        ],
      },
    }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your briefing and next checks.' }),
  ).toBeVisible();
  await expect(page.locator('.trip-lead').getByRole('link')).toHaveAttribute(
    'href',
    fixture.sources[0].url,
  );
  await expect(
    page.getByText('Only a search snippet was available.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Check official weather warnings/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('confirmed location, partial weather and source quality remain clear on desktop and mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let payload;
  await page.route('**/api/analyze', (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: fixture });
  });
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(
    page.getByRole('heading', { name: 'Heavy rainfall forecast signal' }),
  ).toBeVisible();
  expect(payload.locationId).toBe('hp');
  await expect(
    page.getByText('Forecast available for 2 of 4 trip days'),
  ).toBeVisible();
  await expect(
    page.getByText(
      `No daily forecast for ${prettyDate(plusDays(tomorrow, 2))} – ${prettyDate(tripEnd)}. Conditions on those dates are unknown.`,
    ),
  ).toBeVisible();
  for (const name of [
    'Government source',
    'Snippet only',
    'Older report',
    'Published 1 Jan 2026',
  ]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  for (const width of [1440, 1024, 760, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator('.forecast-coverage')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('cancel aborts the request and allows another scan', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/analyze', () => {
    requests += 1;
  });
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(page.getByRole('button', { name: 'Cancel scan' })).toBeVisible();
  await expect(page.getByLabel('Travel start date')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Scan cancelled. You can change your trip and try again.',
  );
  await expect(page.getByLabel('Travel start date')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/analyze');
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(page.locator('.issue-card')).toHaveCount(1);
  expect(requests).toBe(1);
});

test('changing the destination clears its previous confirmation', async ({
  page,
}) => {
  await chooseDestination(page);
  await page.getByLabel('WHERE ARE YOU GOING?').fill('Delhi');
  await expect(
    page.getByRole('group', { name: 'Confirm your destination' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeEnabled();
});

test('rate-limit responses show a retry time', async ({ page }) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '45' },
      json: { error: 'Request limit reached.', code: 'RATE_LIMITED' },
    }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Try again in 45 seconds.',
  );
});

test('expired location confirmation can be refreshed', async ({ page }) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: 'Confirm your destination again.',
        code: 'LOCATION_REQUIRED',
      },
    }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Confirm your destination again.',
  );
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Find destination' }).click();
  await expect(page.getByRole('radio')).toHaveCount(2);
});

test('location lookup can be cancelled before confirming a destination', async ({
  page,
}) => {
  await page.unroute('**/api/locations?*');
  await page.route('**/api/locations?*', () => {});
  await page.goto('/');
  await page.getByLabel('WHERE ARE YOU GOING?').fill('Rampur');
  await page.getByRole('button', { name: 'Find destination' }).click();
  await expect(
    page.getByRole('heading', { name: 'Finding your destination' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByRole('status')).toContainText('Scan cancelled.');
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeEnabled();
});

test('saved trip plans, reminders and the selected theme persist without reusing a location confirmation', async ({
  page,
}) => {
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use saved plan for Rampur' }),
  ).toBeVisible();
  await page.getByLabel('Confirm transport & accommodation').check();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByLabel('Confirm transport & accommodation'),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Use saved plan for Rampur' }).click();
  await expect(page.getByLabel('WHERE ARE YOU GOING?')).toHaveValue('Rampur');
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeEnabled();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(
    page.getByLabel('Confirm transport & accommodation'),
  ).not.toBeChecked();
  const plans = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tracerisk.plans.v1')),
  );
  expect(plans[0].locationId).toBeUndefined();
  expect(plans[0].riskScore).toBeUndefined();
  await page
    .getByRole('button', { name: 'Remove saved plan for Rampur' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Use saved plan for Rampur' }),
  ).toHaveCount(0);
});

test('quick date choices create a valid trip across month boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'This weekend', exact: true }).click();
  const start = await page.getByLabel('Travel start date').inputValue();
  const end = await page.getByLabel('Travel end date').inputValue();
  expect(new Date(`${start}T12:00:00`).getDay()).toBe(6);
  expect(new Date(`${end}T12:00:00`).getDay()).toBe(0);
  await page.getByRole('button', { name: 'Jaipur', exact: true }).click();
  await expect(page.getByLabel('WHERE ARE YOU GOING?')).toHaveValue('Jaipur');
});

test('signals and evidence can be filtered without changing the overall briefing', async ({
  page,
}) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        issueCount: 2,
        issues: [
          ...fixture.issues,
          {
            id: 'road',
            title: 'Mountain road diversion',
            dimension: 'Infrastructure / Transit',
            severity: 'moderate',
            score: 50,
            confidence: 0.9,
            sourceIds: ['S2'],
          },
        ],
        sources: [
          ...fixture.sources,
          {
            id: 'S2',
            title: 'Transport update',
            domain: 'news.example.org',
            url: 'https://news.example.org/update',
            trust: 'News outlet',
            fetched: true,
          },
        ],
      },
    }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(page.locator('.issue-card')).toHaveCount(2);
  await page.getByRole('button', { name: /^Transport/ }).click();
  await expect(page.locator('.issue-card')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Mountain road diversion' }),
  ).toBeVisible();
  await expect(page.locator('.coverage-strip')).toContainText(
    'Some evidence is missing or weak.',
  );
  await page.getByRole('button', { name: /^Health/ }).click();
  await expect(
    page.getByText(
      'No signals in this category. The overall scan coverage still applies.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show all signals' }).click();
  await page.getByLabel('Sort signals').selectOption('confidence');
  await expect(page.locator('.issue-card').first()).toContainText(
    'Mountain road diversion',
  );
  await page.getByLabel('Search reviewed sources').fill('does-not-exist');
  await expect(page.getByText('No sources match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page
    .getByLabel('Source type', { exact: true })
    .selectOption('official');
  await expect(page.locator('.source-list-item')).toHaveCount(1);
  await expect(page.locator('.source-list-item')).toContainText(
    'District weather advisory',
  );
});

test('downloaded briefings include evidence and incomplete forecast dates', async ({
  page,
}) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ json: fixture }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download briefing' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tracerisk-.*\.txt$/);
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('Source coverage: limited');
  expect(text).toContain('Daily forecast coverage: 2 of 4 trip days');
  expect(text).toContain('https://example.gov.in/advisory');
  expect(text).toContain('not an official safety rating');
});

test('unavailable browser storage does not prevent planning', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Unavailable', 'QuotaExceededError');
    };
  });
  await page.goto('/');
  await page.getByLabel('WHERE ARE YOU GOING?').fill('Jaipur');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use saved plan for Jaipur' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Browser storage is unavailable. Plans stay for this visit.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Find destination' }),
  ).toBeEnabled();
});

test('print view preserves warnings and explains active filters', async ({
  page,
}) => {
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ json: fixture }),
  );
  await chooseDestination(page);
  await page.getByRole('button', { name: 'Check my trip' }).click();
  await expect(
    page.getByRole('button', { name: 'Download briefing' }),
  ).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByText(
      'This printed view reflects the selected signal and source filters. Download the briefing for all findings and source links.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Some evidence is missing or weak.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download briefing' }),
  ).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Where are we heading?' }),
  ).toBeHidden();
});
