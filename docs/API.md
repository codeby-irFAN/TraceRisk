# HTTP API

[README](../README.md) · [Deployment](DEPLOYMENT.md) · [Engineering decisions](../DECISIONS.md)

Express defaults to `http://127.0.0.1:8787`. During development the frontend can use relative `/api` URLs through Vite. In production Express serves the built frontend and API from the same origin. Dates are calendar strings in `YYYY-MM-DD` format; timestamps are ISO strings.

Examples below describe shapes and workflow. Illustrative values are not observed scan results, and no example location ID is reusable.

## `GET /api/health`

Reports server configuration. It does not call providers or validate keys, models, account quota, or network access.

Relevant fields include:

| Field                                                  | Meaning                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `ok`, `service`                                        | Server response status and service name.                          |
| `tinyfishConfigured`                                   | A non-placeholder TinyFish credential is present.                 |
| `llmConfigured`, `groqConfigured`                      | Non-placeholder assessment credentials are present.               |
| `primaryProvider`, `fallbackProvider`, `providerOrder` | Groq when configured, otherwise Rules; fallback provider is null. |
| `model`, `fallbackModel`                               | Configured/default Groq model; fallbackModel is null.             |
| `searchLanes`, `maxWebSources`, `scanBudgetMs`         | Collection and timing settings.                                   |
| `weatherProxyMode`, `weatherProxyConfigured`           | Direct/Worker routing and whether proxy URL/token are set.        |

Key and token values are not returned. Known template placeholders are treated as missing; a configured flag can still be true for an invalid key.

## `GET /api/locations?destination=...`

Resolve an Indian destination before scanning. The query must be a string of at least two characters after cleaning; the server retains up to 90 characters. Add a state or district when a place name is ambiguous.

```sh
curl --get 'http://127.0.0.1:8787/api/locations' --data-urlencode 'destination=Rampur'
```

A successful response has this general shape:

```json
{
  "locations": [
    {
      "id": "opaque-server-issued-id",
      "label": "Rampur, Himachal Pradesh, India",
      "name": "Rampur",
      "admin1": "Himachal Pradesh",
      "admin2": "",
      "country": "India",
      "latitude": 31.4,
      "longitude": 77.6,
      "timezone": "Asia/Kolkata"
    }
  ],
  "cached": false,
  "shared": false
}
```

The coordinates above are illustrative. Available administrative fields and labels depend on the provider. At most eight valid Indian choices are returned. A successful lookup can return `locations: []`; that is not a confirmed destination.

Display the choices and let the user select one. IDs are bound to the normalized original query and expire after at most ten minutes; restart or bounded-store eviction can also invalidate them. They are confirmation handles, not user authentication. Lookups can be shared and cached; clients should not depend on an ID remaining valid beyond a single planning session.

## `POST /api/analyze`

Requires a selected ID from a lookup on the same process. A TinyFish key enables web evidence; missing/failed search still permits weather and next checks with incomplete coverage.

```json
{
  "destination": "Rampur",
  "locationId": "copy-the-selected-id-from-your-lookup",
  "startDate": "2026-11-07",
  "endDate": "2026-11-09"
}
```

Use the same `destination` query that produced the choice, with valid dates in the intended travel window. These example dates are illustrative; update them when trying the API. Dates must exist on the calendar and the end must not precede the start. The browser prevents past-date selection; API consumers should choose appropriate dates themselves.

Send `Content-Type: application/json`. The body limit is 32 KB and the trip may contain at most 90 days. Do not send provider keys in browser/API payloads. Client-supplied coordinates or location objects are ignored: the server uses the stored choice and its label.

Successful response fields include:

| Group             | Fields and purpose                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Trip              | `destination` is the confirmed place label; `startDate`, `endDate`, and `checkedAt` identify the trip and collection time.             |
| Findings          | `issues`, `hasIssues`, `issueCount`, `riskScore`, `riskLevel`, and `briefing`. Scores are heuristic signals, not safety probabilities. |
| Evidence          | `sources` with IDs, titles, links, source type, publication metadata, `fetched`, category, and preview text.                           |
| Coverage          | `coverageStatus`, `relevantSources`, `searchLaneStats`, and `sourceHealth`.                                                            |
| Weather           | `weather` includes resolved location, forecast/flood status, daily records, river flow, warnings, and date coverage.                   |
| Assessment        | `analysisMode` (`llm` or `rules`), `model`, `providerUsed`, and optional fallback metadata.                                            |
| Collection counts | `searchResultsReturned`, `sourcesChecked`, `pagesFetched`, `weatherSourcesChecked`, and related selected-source counts.                |
| Timing/cache      | `durationMs`, stage timing fields, `cached`, and `shared`.                                                                             |
| Limits            | `disclaimer` explains prototype and model-data limitations.                                                                            |

Each issue contains a title, dimension, severity, score, confidence, area, summary, travel impact, evidence excerpt, and valid `sourceIds` referencing the returned evidence. Actual findings depend on collection; there is no guaranteed issue count or successful provider sequence.

Version 4 adds `engineVersion`, `resultStatus` (`complete`, `partial`, `unavailable`), `highlights`, `leads` and `nextSteps`. Lead entries contain a title, excerpt, source IDs and a reason that they were not promoted to findings. Next steps contain a title, URL and detail. These remain available with empty `issues`; clients should render them rather than treating an empty issue array as a failed scan.

Sources add `originalUrl`, `retrievedAt`, `publicationDateBasis`, `contentHash` and `quality` (place match, relevance, recency, reasons). Redirect URLs determine the displayed publisher. Hashes cover the retained excerpt, not an archived full document. `evidenceStatus` and `dateBasis` explain findings. Numeric confidence is legacy heuristic metadata, not calibrated accuracy.

`performance` contains `budgetMs`, `elapsedMs` and per-stage status/duration. `collectedAt` records engine start; source retrieval timestamps record collection or original weather-cache retrieval. `checkedAt` records completion and remains unchanged on cache hits. `requestId` matches the `X-Request-Id` header; API responses use `Cache-Control: no-store`. Successful scans add `Server-Timing`.

### Interpreting the response

- `adequate`, `limited`, and `inconclusive` describe source collection, not safety; see the [exact criteria](../DECISIONS.md#coverage-is-separate-from-findings). `resultStatus: complete` refers to web collection, not complete weather coverage or exhaustive incident detection.
- A lane with `succeeded: true` may still have `resultCount: 0`; check both.
- `fetched: false` on a webpage means only a search snippet/title was available. Weather API records are a different source type.
- A government-domain badge identifies a website type, not the freshness or applicability of an advisory.
- Publication dates come from provider metadata. Undated and old reports need verification.
- `cached: true` means a completed result was reused within its 60-second cache window. `checkedAt` remains the original collection timestamp.
- `shared: true` on an uncached response means the request joined an existing job. It does not get a fresh 20-second budget; `durationMs` measures this request's wait.

### Daily forecast coverage

```json
{
  "tripDays": 4,
  "forecastDaysMatched": 2,
  "forecastCoverage": "partial",
  "forecastMissingDateRanges": [{ "start": "2026-11-09", "end": "2026-11-10" }]
}
```

This illustrates partial coverage for a four-day trip ending on November 10. `forecastCoverage` is `complete`, `partial`, or `unavailable`. Missing ranges refer to daily forecasts, independently of flood-model availability. Only usable records inside the trip window count. No daily forecast for a date means unknown conditions, not good weather.

## Cancellation and capacity

Abort the browser fetch or close its HTTP connection to stop waiting for a lookup or scan. One subscriber cancelling does not stop a shared job needed by another. The last cancellation aborts the upstream job. Failed, cancelled and wholly unavailable jobs are not cached.

Defaults per Node process:

| Operation       | Per-IP allowance        | Distinct active jobs | Completed cache |
| --------------- | ----------------------- | -------------------- | --------------- |
| Analyze         | 6 requests / 10 minutes | 3                    | 60 seconds      |
| Location lookup | 20 requests / minute    | 4                    | 9 minutes       |

Shared jobs allow up to 100 waiting subscribers. Valid shared/cached requests still count toward request allowances; rate limits also apply before a capacity rejection. Invalid input and missing confirmations are rejected before starting provider work. Quotas and jobs are not coordinated across replicas; see [deployment](DEPLOYMENT.md#request-limits-and-process-state).

## Error responses

Errors generally contain `error` and, where supplied by the route, `code`. Do not assume every error includes a code.

| HTTP  | Code, when present  | Meaning / client response                                                                                        |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `400` | —                   | Invalid destination, dates, or JSON. Correct the request.                                                        |
| `400` | `TRIP_TOO_LONG`     | Trip exceeds 90 days.                                                                                            |
| `400` | `LOCATION_REQUIRED` | Missing, expired, evicted, invented, or query-mismatched location ID. Perform the lookup and confirmation again. |
| `404` | —                   | Unknown API route.                                                                                               |
| `413` | —                   | JSON body exceeds the configured limit.                                                                          |
| `429` | `RATE_LIMITED`      | Client allowance or limiter capacity exceeded. Respect `Retry-After`.                                            |
| `429` | `SCAN_CAPACITY`     | Distinct job/subscriber capacity reached; also used by the lookup manager. Respect `Retry-After`.                |
| `504` | `SCAN_TIMEOUT`      | A scan or lookup exceeded its overall budget.                                                                    |
| `502` | `SCAN_FAILED`       | An unhandled collection/lookup failure prevented a useful response.                                              |
| `500` | —                   | Unexpected server error.                                                                                         |

HTTP 429 responses include `Retry-After` as seconds. Partial provider failures can instead produce a successful, limited/inconclusive response with warnings and fallback metadata; HTTP 200 is not proof of complete coverage. Missing credentials and provider authentication failures appear as failed lane diagnostics; they do not fabricate successful searches.

## Trip workspace API (v5)

The trip API now uses account session cookies. `POST /api/workspaces` and bearer-key authentication are removed. Send `X-TraceRisk-Request: 1` on all account/trip/workspace mutations; cross-origin mutations are rejected. Use cookie-aware requests over HTTPS. Passwords never appear in responses.

| Method / path             | Behaviour                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/session`   | Current `{user}` or `{user:null}`                                                                        |
| `POST /api/auth/register` | `{name,email,password}`; password 10–128 characters; sets an HttpOnly, SameSite=Lax cookie               |
| `POST /api/auth/login`    | `{email,password}`; sets a 14-day session cookie                                                         |
| `POST /api/auth/logout`   | Revokes current session and clears cookie                                                                |
| `POST /api/auth/password` | `{currentPassword,newPassword}`; changes password, revokes all sessions and issues a new current session |

Registration and login optionally accept the previous browser's `legacyKey` for automatic ownership migration; it is never accepted as API authentication or returned to the user. Migration requires a valid unclaimed legacy workspace. Each account owns a separate workspace, and unauthorised trip IDs return 404. Email is a sign-in identifier, not verified email ownership; email delivery/password-reset flows are not configured.

| Method / path                 | Behaviour                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /api/workspace`          | Branding, persistence flag and scheduler status                                                     |
| `PATCH /api/workspace`        | `{agencyName,contact,color}`; colour is a six-digit hex string                                      |
| `GET /api/trips`              | Trip summaries, unread counts and scheduler status                                                  |
| `POST /api/trips`             | Create a validated itinerary                                                                        |
| `GET /api/trips/:id`          | Full itinerary, latest evidence, comparison and change timeline                                     |
| `PUT /api/trips/:id`          | Replace itinerary; invalidates results, history and public share                                    |
| `DELETE /api/trips/:id`       | Cancel job and delete trip, history and public share                                                |
| `POST /api/trips/:id/check`   | Start a background check; returns 202; poll the trip for `checking` and completed `latest`          |
| `POST /api/trips/:id/cancel`  | Cancel active check, preserving previous completed evidence                                         |
| `PATCH /api/trips/:id/watch`  | `{enabled,frequencyHours,alertLevel}` (`all` or `high`)                                             |
| `POST /api/trips/:id/read`    | Mark timeline updates read                                                                          |
| `POST /api/trips/:id/compare` | `{dayOffset:0..7,routeIndex:0..2}`; at least one differs from zero; actual supported route required |
| `POST /api/trips/:id/ask`     | `{question}`; evidence-based answer, citations and missing information                              |
| `POST /api/trips/:id/share`   | `{includeClient:false}`; returns path and seven-day expiry; replaces old share                      |
| `DELETE /api/trips/:id/share` | Revoke current share                                                                                |
| `GET /api/shared/:key`        | Public frozen briefing, or 404 when expired/revoked                                                 |

Trip body: `{title,client,origin:null|{query,locationId},stops:[{query,locationId,startDate,endDate}],preferences:{mode,children,limitedMobility,respiratory},watch:{enabled,frequencyHours,alertLevel}}`. Confirm `locationId` from `GET /api/locations?destination=...`; it must match its original query. Do not supply coordinates. When editing, an unchanged place may use `{savedId,query}` referencing its previously saved server-side place. One to six chronological stops, at most 30 days each and 90 days overall. Modes: `car`, `bus`, `motorcycle`, `train`, `flight`. Watch frequencies: 1, 3, 6, 12 or 24 hours. Maximum 50 trips per workspace.

A snapshot contains `reports` for stops/origin/supported corridor areas, explicit per-report dates, route geometry/status/notes, summary counts and collection time. Reports expose `decision.checks` by information type, personal impact, verification/source support and conflicts. Coverage is not a safety probability. Timeline kinds include `new`, `changed`, `not-observed`, `resolved` and `coverage`; source disappearance alone never means resolution. There are up to 100 timeline events per trip.

Registration/login/password changes share a twelve-attempt limit per client/ten minutes; authenticated reads to 180 per client/minute, and checks/comparisons to eight per workspace/ten minutes. At most two full trip jobs run per process. Edit/watch/read operations can return 409 while a check is active; check capacity/rate limits return 429. Jobs and rate counters are process-local; saved trips, completed results and shares reside in SQLite.

## Supabase mode (v5.2)

Configured deployments retain the same trip/workspace HTTP API while storing data in Supabase Postgres. `/api/auth/session` adds `provider: "supabase"`. Registration can return `{user:null,confirmationRequired:true,message}`; the client must show the confirmation instruction and must not treat it as a signed-in session. Authentication uses HttpOnly PKCE cookies, not a browser-supplied user ID. The server verifies users with Supabase Auth before scoping storage. Generated-report writes require the private server secret and cannot be performed directly by an authenticated browser client.

- `GET /auth/callback?code=...`: exchanges a single-use PKCE authorization code and redirects to the app. Recovery also checks the request's same-browser state.
- `POST /api/auth/forgot-password`: `{email}`; sends a generic confirmation and requests a Supabase recovery email. Subject to provider delivery limits.
- `POST /api/auth/reset-password`: `{newPassword}`; requires the short-lived HttpOnly recovery grant from a successful callback and the corresponding current session.

These mutations require the existing `X-TraceRisk-Request: 1` header and accepted Origin. A malformed/expired recovery link returns to the app with a plain-language error. `/api/health` reports `storageProvider` (`sqlite` or `supabase`) and scheduler capability, without secret values. SMTP/email settings and live schema readiness require separate verification.
