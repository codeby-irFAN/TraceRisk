# Backend evaluation

[README](../README.md) · [Decisions](../DECISIONS.md) · [Deployment](DEPLOYMENT.md)

Version 4 has regression-tested evidence checks and a twenty-second processing budget. The measurements below demonstrate working live retrieval in this cloud environment. They do not establish publication-grade factual accuracy or an uptime/latency guarantee.

## Live sample: 22 October 2026

Measured with Node.js 24, TinyFish Search/Fetch and public Open-Meteo endpoints. No AI credentials were configured, so these scans used deterministic quotation verification. Trips covered 22–23 October 2026. The benchmark selected the first ranked location for each explicit query; the normal UI requires a user confirmation.

| Confirmed destination     | Lookup | Scan   | Opened pages | Source leads | Forecast days | Web coverage |
| ------------------------- | ------ | ------ | ------------ | ------------ | ------------- | ------------ |
| Delhi                     | 0.78 s | 7.42 s | 9            | 8            | 2             | limited      |
| Manali (Himachal Pradesh) | 0.71 s | 7.47 s | 7            | 8            | 2             | limited      |
| Guwahati                  | 0.23 s | 7.39 s | 6            | 8            | 2             | limited      |

[Machine-readable measurements](benchmark-2026-10-22.json) include timestamps, provider and status. These were three sequential engine calls without the completed-scan cache; provider-side caching may still affect timings. Lookup is measured separately from the scan. Network proxy support was enabled for this workspace. This is a small sample, not a percentile benchmark, production load test or browser-to-host SLA.

Every result provided local links and two days of forecast data. Guwahati returned a source-supported transport report for the trip window. Delhi and Manali returned useful leads without establishing a current disruption. All three explicitly reported limited web coverage; the system did not turn missing evidence into an all-clear.

Live review during development exposed news-office datelines, ambiguous Manali locations, generic directory pages, navigation-only extractions, dropped publication metadata, repeated headlines and stale disruptions. Regression cases now cover those failure patterns. This targeted review is not an independent incident-detection or factual-accuracy study.

## Reproduce

Configure the web-search credential in your local environment, then run:

```sh
npm run benchmark:live -- --live
# Or specify places, including the state for ambiguous names:
npm run benchmark:live -- --live Delhi "Manali, Himachal Pradesh" Guwahati
```

The explicit `--live` flag opts into real requests and account quota use. Reports are written to ignored `artifacts/benchmarks/`; normal CI never calls paid providers. Each report retains source links, publication metadata, evidence status, stage durations and failures so speed can be reviewed alongside usefulness. Do not publish private travel plans or credentials with diagnostic output.

## Automated verification

The completed change passes 58 Node tests, 13 Playwright browser tests, the production build and formatting checks. Fixtures cover:

- Wrong places/states, ambiguous names, unrelated news and invalid URLs.
- Fabricated citations, altered quotations, cherry-picked negation, resolved/historical reports and stale dates.
- Explicit dates, cautious publication-year inference, future trips and missing forecast days.
- Duplicate reports, bounded scores and unsupported model narratives.
- Slow/failed providers, concurrent collection, cancellation, queue cleanup, bounded bodies and shared jobs.
- Weather-only responses without search credentials; useful leads when extraction fails; unavailable results excluded from cache.
- Location confirmation, API input limits, quotas, request headers and saved-plan behavior.
- Sparse-result briefings, mobile widths, themes, filters, downloads and printing.

Provider tests check Groq success, a quota failure without retries, and skipping AI when its key is missing. It does not validate live model access, response quality or paid-account limits. Unit latency checks use shortened deterministic budgets; live samples use the actual twenty-second budget.

## What still needs validation before a public safety claim

Accuracy requires an independently labelled set of current incidents and non-incidents, including local-language reporting, small towns, ambiguous place names, resolved events and future trips. Measure precision and missed incidents separately; a low alert count alone is not evidence of accuracy. Quotation matching establishes what a page said, not that the page is true or the situation remains active.

Search indexing and extraction can miss genuine reports. Geographic/topic/date rules are deliberately conservative, and English-focused retrieval limits coverage. Forecasts remain model-derived. A public deployment additionally needs live checks with its actual AI account, hosting topology and representative concurrent traffic; cold starts are outside the engine's processing budget. Commercial weather rights are required for an ad-funded service, as described in the deployment guide.

## Version 5 workspace validation

The trip workspace has automated checks for SQLite restart persistence, workspace isolation, optimistic revisions, overlapping-job claims, replacement/revocation/expiry of public briefings, scheduled checks, real date-offset rechecks, assistant citations, cancellation preserving previous results, conservative resolution detection, source coordinates, GDACS date/distance filtering and OSRM geometry validation. Browser tests exercise creation, place confirmation, check results, evidence, map fallback, change timeline, comparison, assistant, briefing generation and client-trip management, plus a mobile public briefing.

These are deterministic fixture/API tests, not evidence of a calibrated safety decision rate. OSRM and GDACS were blocked by the cloud network proxy; direct air-quality requests also failed here. The implementation reports unavailable coverage and retains useful trip checks. Live provider contracts and commercial service availability must be verified on the deployment host. The earlier three-place timings above measure version 4 single-destination scans, not version 5 full itineraries.

Local validation for this release: **67 Node tests and 15 Playwright tests passed**, along with formatting and a production build. The new desktop light/dark, mobile workspace and public briefing layouts were also visually inspected. Hosted CI and deployment availability are separate checks.

## Version 5.1 account and usability checks

Local verification passed **73 Node tests and 16 Playwright tests**, formatting and a production build. New checks cover salted password hashing, cookie session persistence/expiry/revocation, sign-out, incorrect passwords, password changes, CSRF rejection, account access isolation and legacy-trip import. The browser test creates and reloads a real two-stop Qutub Minar/Hawa Mahal itinerary through the account API without mocking landmark lookup or storage. Assistant tests verify dated weather citations, unsupported opening-hour handling and out-of-trip-date questions. Tile failure tests verify that route/stop overlays remain usable and a fallback message replaces failed backgrounds. Desktop/mobile account screens were visually inspected.

Live Photon/CARTO requests were blocked by this cloud proxy. Broader landmark search and live map backgrounds still need deployment-host verification; bundled landmark search does not depend on that access. These checks do not establish production uptime, email ownership verification or email password recovery.

## Version 5.2 Supabase validation

Local validation passed **77 Node tests and 17 browser tests**, plus formatting and the production build. The actual SQL migration is applied twice in embedded PostgreSQL, and tests exercise private account reads, server-only report writes, revision conflicts, overlapping claims, public-share revocation/expiry and denial of scheduler access to ordinary users. Adapter tests isolate concurrent user tokens and preserve token context through asynchronous Express middleware. Authentication fixtures cover confirmation-required registration and rejection of an invalid recovery callback/grant; browser tests cover confirmation and forgot-password guidance. No real account or email was created during validation.

The live Supabase project request was blocked by this cloud network proxy (HTTP 403 tunnel rejection). The schema has **not** been applied to the user's project and Render settings have **not** been changed. Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md), then separately verify live sign-in, email delivery, storage and sharing. The optional SQLite import tool requires a backed-up database and an explicitly reviewed ownership mapping.
