import { test, expect } from '@playwright/test';

const locations = [
  { id: 'up', label: 'Rampur, Uttar Pradesh, India' },
  { id: 'hp', label: 'Rampur, Himachal Pradesh, India' },
];
const fixture = {
  destination: locations[1].label,
  startDate: '2026-10-22',
  endDate: '2026-10-25',
  checkedAt: '2026-10-21T12:00:00Z',
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
    forecastMissingDateRanges: [{ start: '2026-10-24', end: '2026-10-25' }],
    dailyForecast: [
      { date: '2026-10-22', maxC: 30, minC: 22, precipitationMm: 60 },
    ],
  },
};

async function chooseDestination(page) {
  await page.goto('/');
  await page.getByLabel('WHERE ARE YOU GOING?').fill('Rampur');
  await page.getByLabel('Travel start date').fill('2026-10-22');
  await page.getByLabel('Travel end date').fill('2026-10-25');
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
    page.getByText(/No daily forecast for 24 Oct 2026 – 25 Oct 2026/),
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
