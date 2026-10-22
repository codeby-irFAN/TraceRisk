import { test, expect } from '@playwright/test';
const place = {
  name: 'Delhi',
  admin1: 'Delhi',
  country: 'India',
  latitude: 28.6,
  longitude: 77.2,
};
const stop = {
  id: 'stop-1',
  query: 'Delhi',
  location: place,
  startDate: '2026-10-22',
  endDate: '2026-10-23',
};
const source = {
  id: 'S1',
  title: 'District road advisory',
  url: 'https://example.gov.in/advisory',
};
const report = {
  key: 'stop-1',
  kind: 'stop',
  label: 'Delhi, India',
  location: place,
  startDate: stop.startDate,
  endDate: stop.endDate,
  result: {
    checkedAt: '2026-10-22T10:00Z',
    issues: [
      {
        id: 'rain',
        title: 'Heavy rain along access roads',
        summary: 'Check the affected access road.',
        area: 'Delhi region',
        sourceIds: ['S1'],
        score: 65,
        evidence: 'Rain may disrupt access roads on 2026-10-22.',
        personalImpact: ['Allow extra time for bus transfers.'],
        verification: {
          label: 'Single-source report',
          confidence: 'Limited corroboration',
          eventDateNote: '2026-10-22',
          supporting: [source],
          conflicts: [],
        },
      },
    ],
    sources: [source],
    decision: {
      title: 'Review this part of your plan',
      detail: 'One current report to review.',
      checks: [
        {
          id: 'weather',
          label: 'Weather for your dates',
          status: 'checked',
          detail: '2 of 2 days covered',
        },
      ],
    },
    nextSteps: [],
    weather: { dailyForecast: [] },
  },
};
const latest = {
  checkedAt: '2026-10-22T10:00Z',
  issueCount: 1,
  highSignals: 1,
  reportsChecked: 1,
  reportsTotal: 1,
  coverage: 'partial',
  reports: [report],
  route: {
    status: 'unavailable',
    routes: [],
    notes: ['Road route unavailable; stop checks remain available.'],
  },
};
const baseTrip = {
  id: 'trip-1',
  title: 'Mountain holiday',
  client: 'Family group',
  stops: [stop],
  preferences: { mode: 'bus', children: true },
  watch: { enabled: true, frequencyHours: 6, alertLevel: 'all' },
  latest: null,
  timeline: [],
  checking: false,
  revision: 1,
};
test('plan, check, inspect evidence, compare, ask and share a trip', async ({
  page,
}) => {
  let trip = structuredClone(baseTrip),
    saved = false;
  await page.route('**/api/locations?**', (r) =>
    r.fulfill({ json: { locations: [{ ...place, id: 'delhi' }] } }),
  );
  await page.route('**/api/trips**', async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname,
      method = r.request().method();
    if (path === '/api/trips') {
      if (method === 'POST') {
        saved = true;
        const body = r.request().postDataJSON();
        trip = { ...trip, ...body, stops: [stop] };
        return r.fulfill({ status: 201, json: { trip } });
      }
      return r.fulfill({
        json: {
          trips: saved ? [{ ...trip, unreadCount: trip.timeline.length }] : [],
        },
      });
    }
    if (path.endsWith('/check')) {
      trip.latest = structuredClone(latest);
      trip.timeline = [
        {
          id: 'event',
          kind: 'new',
          title: 'Heavy rain along access roads',
          at: latest.checkedAt,
          detail: 'A new report appeared.',
          sourceLinks: [source],
        },
      ];
      return r.fulfill({ status: 202, json: { status: 'checking' } });
    }
    if (path.endsWith('/compare')) {
      trip.comparison = {
        dayOffset: 1,
        routeIndex: 0,
        candidate: latest,
        notes: ['Fewer reports do not prove safety.'],
      };
      return r.fulfill({ status: 202, json: { status: 'checking' } });
    }
    if (path.endsWith('/ask'))
      return r.fulfill({
        json: {
          answer: 'Confirm the affected bus access road [1].',
          citations: [{ ...source, label: '[1]' }],
          missing: ['Check the latest operator notice.'],
        },
      });
    if (path.endsWith('/share'))
      return r.fulfill({
        status: 201,
        json: { path: '/share/test-briefing', expiresAt: '2026-10-29T10:00Z' },
      });
    return r.fulfill({ json: { trip } });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: /Create my private workspace/ })
    .click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('Mountain holiday');
  await page.getByLabel('Destination', { exact: true }).fill('Delhi');
  await page.getByRole('button', { name: 'Find place' }).click();
  await page.getByRole('button', { name: /Delhi, Delhi/ }).click();
  await page.getByRole('button', { name: 'Save itinerary' }).click();
  await page.getByRole('button', { name: 'Check trip', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review this part of your plan' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await expect(
    page.getByText('Rain may disrupt access roads on 2026-10-22.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /District road advisory/ }).first(),
  ).toHaveAttribute('href', source.url);
  await page.getByRole('tab', { name: 'Route map', exact: true }).click();
  await expect(page.getByLabel('Interactive trip route map')).toBeVisible();
  await page.getByRole('tab', { name: 'What changed', exact: true }).click();
  await expect(page.getByText('A new report appeared.')).toBeVisible();
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Compare this option' }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved departure' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await page
    .getByRole('button', { name: 'Ask trip assistant', exact: true })
    .click();
  await expect(
    page.getByText('Confirm the affected bus access road [1].'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Create briefing link' }).click();
  await expect(page.getByRole('link', { name: /test-briefing/ })).toBeVisible();
  await page.getByRole('button', { name: 'Travel desk', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: /Mountain holiday/ }),
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/tracerisk-workspace-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: '/tmp/tracerisk-workspace-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Trips', exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/tmp/tracerisk-workspace-mobile.png',
    fullPage: true,
  });
});
test('mobile workspace is readable and private briefing renders without a key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/shared/**', (r) =>
    r.fulfill({
      json: {
        title: 'Shared mountain holiday',
        stops: [stop],
        latest,
        agency: {
          name: 'Field Guide Travel',
          contact: 'Contact your trip organiser',
          color: '#28594a',
        },
      },
    }),
  );
  await page.goto('/share/example');
  await expect(
    page.getByRole('heading', { name: 'Shared mountain holiday' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/tmp/tracerisk-briefing-mobile.png',
    fullPage: true,
  });
});
