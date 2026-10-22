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
      expect(r.request().postDataJSON().scanMode).toBe('thorough');
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
  await page.getByLabel('Your name').fill('Test traveller');
  await page
    .getByLabel('Email', { exact: true })
    .fill('trip-traveller@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('test-travel-password-42');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('Mountain holiday');
  await page.getByLabel('Destination', { exact: true }).fill('Delhi');
  await page.getByRole('button', { name: 'Find place' }).click();
  await page.getByRole('button', { name: /Delhi · India/ }).click();
  await page.getByRole('button', { name: 'Save itinerary' }).click();
  await page.getByLabel('Check type', { exact: true }).selectOption('thorough');
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
  await page.route(/https:\/\/tile\.openstreetmap\.org\/.*/, async (r) => {
    const headers = await r.request().allHeaders();
    expect(headers.referer).toBe(new URL(page.url()).origin + '/');
    await r.fulfill({ status: 503, body: '' });
  });
  await page.getByRole('tab', { name: 'Route map', exact: true }).click();
  await expect(page.getByLabel('Interactive trip route map')).toBeVisible();

  await expect(
    page.getByText(/The map background could not load/),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'What changed', exact: true }).click();
  await expect(page.getByText('A new report appeared.')).toBeVisible();
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Compare this option' }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved departure' }),
  ).toBeVisible();
  await expect(page.getByText('Unavailable min driving estimate')).toHaveCount(
    0,
  );
  await expect(
    page.getByText('Coverage: collected with stated gaps'),
  ).toHaveCount(0);
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

test('account sign-in persists across reload, signs out and protects saved trips', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.screenshot({
    path: '/tmp/tracerisk-auth-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/tmp/tracerisk-auth-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 820 });

  await page.getByLabel('Your name').fill('Account traveller');
  await page
    .getByLabel('Email', { exact: true })
    .fill('account-browser@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('secure-travel-password-43');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Good plans start here.' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Good plans start here.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('Account traveller · account-browser@example.com'),
  ).toBeVisible();
  await expect(page.getByText('Workspace recovery key')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Email', { exact: true })
    .fill('account-browser@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await page
    .getByLabel('Password', { exact: true })
    .fill('secure-travel-password-43');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Good plans start here.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('Historic attractions');
  await page
    .getByLabel('Destination', { exact: true })
    .fill('Qutub Minar, Delhi');
  await page.getByRole('button', { name: 'Find place', exact: true }).click();
  await page.getByRole('button', { name: /Qutub Minar, Delhi/ }).click();
  await page
    .getByRole('button', { name: '＋ Add another stop', exact: true })
    .click();
  await page
    .getByLabel('Destination', { exact: true })
    .nth(1)
    .fill('Hawa Mahal, Jaipur');
  await page
    .getByRole('button', { name: 'Find place', exact: true })
    .nth(1)
    .click();
  await page.getByRole('button', { name: /Hawa Mahal, Jaipur/ }).click();
  await page
    .getByRole('button', { name: 'Save itinerary', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Historic attractions', exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async () => (await (await fetch('/api/trips')).json()).trips[0],
  );
  expect(saved.stops[0].location.kind).toBe('landmark');
  expect(saved.stops[0].location.latitude).toBe(28.524428);
  expect(saved.stops[1].location.city).toBe('Jaipur');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Historic attractions', exact: true }),
  ).toBeVisible();
});

test('Supabase confirmation and forgot-password screens explain the next step', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: null, provider: 'supabase' } }),
  );
  await page.route('**/api/auth/register', (r) =>
    r.fulfill({
      status: 201,
      json: {
        user: null,
        confirmationRequired: true,
        message: 'Check your email to confirm your account, then sign in.',
      },
    }),
  );
  await page.route('**/api/auth/forgot-password', (r) =>
    r.fulfill({
      json: {
        message:
          'If an account uses that email, a password-reset link will arrive shortly. Open it in this browser.',
      },
    }),
  );
  await page.goto('/');
  await page.getByLabel('Your name').fill('Supabase traveller');
  await page.getByLabel('Email', { exact: true }).fill('confirm@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('valid-new-password-456');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByText('Check your email to confirm your account, then sign in.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New trip', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: '/tmp/tracerisk-google-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: '/tmp/tracerisk-google-mobile.png',
    fullPage: true,
  });
  await page.route('**/api/auth/google', (r) =>
    r.fulfill({
      status: 503,
      json: {
        error:
          'Google sign-in is not enabled yet. Please use email and password.',
      },
    }),
  );
  await page
    .getByRole('button', { name: 'Continue with Google', exact: true })
    .click();
  await expect(
    page.getByText(
      'Google sign-in is not enabled yet. Please use email and password.',
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Forgot password?', exact: true })
    .click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('confirm@example.com');
  await page
    .getByRole('button', { name: 'Send reset link', exact: true })
    .click();
  await expect(page.getByText(/password-reset link will arrive/)).toBeVisible();
});
