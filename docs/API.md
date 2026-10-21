# HTTP API

[README](../README.md) · [Deployment](DEPLOYMENT.md) · [Engineering decisions](../DECISIONS.md)

Express defaults to `http://127.0.0.1:8787`. During development the frontend can use relative `/api` URLs through Vite. In production Express serves the built frontend and API from the same origin. Dates are calendar strings in `YYYY-MM-DD` format; timestamps are ISO strings.

Examples below describe shapes and workflow. Illustrative values are not observed scan results, and no example location ID is reusable.

## `GET /api/health`

Reports server configuration. It does not call providers or validate keys, models, account quota, or network access.

Relevant fields include:

| Field                                                  | Meaning                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `ok`, `service`                                        | Server response status and service name.                   |
| `tinyfishConfigured`                                   | A nonempty TinyFish key value is present.                  |
| `llmConfigured`, `geminiConfigured`, `groqConfigured`  | Nonempty assessment credentials are present.               |
| `primaryProvider`, `fallbackProvider`, `providerOrder` | Configured assessment order.                               |
| `model`, `fallbackModel`                               | Configured/default primary model names.                    |
| `searchLanes`, `maxWebSources`, `scanBudgetMs`         | Collection and timing settings.                            |
| `weatherProxyMode`, `weatherProxyConfigured`           | Direct/Worker routing and whether proxy URL/token are set. |

Key and token values are not returned. A configured flag can be true for an invalid key or an example placeholder.

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

Requires a valid TinyFish key on the server and a selected ID from a lookup on the same process.

```json
{
  "destination": "Rampur",
  "locationId": "copy-the-selected-id-from-your-lookup",
  "startDate": "2026-11-07",
  "endDate": "2026-11-09"
}
```

Use the same `destination` query that produced the choice, with valid dates in the intended travel window. These example dates are illustrative; update them when trying the API. Dates must exist on the calendar and the end must not precede the start. The browser prevents past-date selection; API consumers should choose appropriate dates themselves.

Send `Content-Type: application/json`. The body limit is 1 MB. Do not send provider keys in browser/API payloads. Client-supplied coordinates or location objects are ignored: the server uses the stored choice and its label.

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

### Interpreting the response

- `adequate`, `limited`, and `inconclusive` describe source collection, not safety.
- A lane with `succeeded: true` may still have `resultCount: 0`; check both.
- `fetched: false` on a webpage means only a search snippet/title was available. Weather API records are a different source type.
- A government-domain badge identifies a website type, not the freshness or applicability of an advisory.
- Publication dates come from provider metadata. Undated and old reports need verification.
- `cached: true` means a completed result was reused within its 45-second cache window. `checkedAt` remains the original collection timestamp.
- `shared: true` on an uncached response means the request joined an existing job. It does not get a fresh 100-second budget; `durationMs` measures this request's wait.

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

Abort the browser fetch or close its HTTP connection to stop waiting for a lookup or scan. One subscriber cancelling does not stop a shared job needed by another. The last cancellation aborts the upstream job. Failed and cancelled jobs are not cached.

Defaults per Node process:

| Operation       | Per-IP allowance        | Distinct active jobs | Completed cache |
| --------------- | ----------------------- | -------------------- | --------------- |
| Analyze         | 6 requests / 10 minutes | 3                    | 45 seconds      |
| Location lookup | 20 requests / minute    | 4                    | 9 minutes       |

Shared jobs allow up to 100 waiting subscribers. Valid shared/cached requests still count toward request allowances; rate limits also apply before a capacity rejection. Invalid input and missing confirmations are rejected before starting provider work. Quotas and jobs are not coordinated across replicas; see [deployment](DEPLOYMENT.md#request-limits-and-process-state).

## Error responses

Errors generally contain `error` and, where supplied by the route, `code`. Do not assume every error includes a code.

| HTTP  | Code, when present     | Meaning / client response                                                                                        |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `400` | —                      | Invalid destination, dates, or JSON. Correct the request.                                                        |
| `400` | `LOCATION_REQUIRED`    | Missing, expired, evicted, invented, or query-mismatched location ID. Perform the lookup and confirmation again. |
| `404` | —                      | Unknown API route.                                                                                               |
| `413` | —                      | JSON body exceeds the configured limit.                                                                          |
| `429` | `RATE_LIMITED`         | Client allowance or limiter capacity exceeded. Respect `Retry-After`.                                            |
| `429` | `SCAN_CAPACITY`        | Distinct job/subscriber capacity reached; also used by the lookup manager. Respect `Retry-After`.                |
| `503` | `MISSING_TINYFISH_KEY` | The scan route has no configured TinyFish credential. Configure it on the server.                                |
| `504` | `SCAN_TIMEOUT`         | A scan or lookup exceeded its overall budget.                                                                    |
| `502` | `SCAN_FAILED`          | An unhandled collection/lookup failure prevented a useful response.                                              |
| `500` | —                      | Unexpected server error.                                                                                         |

HTTP 429 responses include `Retry-After` as seconds. Partial provider failures can instead produce a successful, limited/inconclusive response with warnings and fallback metadata; HTTP 200 is not proof of complete coverage. Provider-authentication failures are not automatically equivalent to the server's missing-key error.
