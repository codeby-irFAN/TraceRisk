# Engineering decisions

This document describes the implemented behavior on `main`, including the planning workspace and the backend controls. It records tradeoffs rather than claiming that the prototype is a calibrated safety system. Operational instructions are in the [deployment guide](docs/DEPLOYMENT.md); the request contract is in the [API reference](docs/API.md).

## Product scope

TraceRisk is a domestic India travel-awareness tool. It surfaces evidence-backed leads and collection limitations for a place and date window. It must not turn missing data, a failed scan, an empty issue list, or a zero score into a guarantee of safety. Model weather signals must remain distinct from official meteorological warnings.

## Confirm the place before collecting trip evidence

`GET /api/locations` resolves Indian locations through Open-Meteo. The UI requires a user selection even if only one choice is returned. Results include city, district/state where available, country, and coordinates so similarly named places can be distinguished.

The server stores opaque choice IDs with their normalized lookup query and an expiry of ten minutes. `POST /api/analyze` must carry an ID associated with the same query. The server uses that stored place for both search context and weather coordinates; arbitrary coordinates in a client request are ignored. Confirmations are process-local and can be invalidated by a restart or bounded-store eviction. They are not authentication credentials or durable bookmarks.

This adds a confirmation step and makes geocoding availability a prerequisite for the normal UI scan flow, but avoids silently attaching one city's forecast to a different destination.

## Search breadth and extraction

Eight TinyFish lanes cover roads, public transport, civil unrest, official advisories, health, crime, infrastructure, and regional news. Each starts with a targeted query. When no usable URLs remain, or certain transient targeted failures occur, it can try one broader query without the targeted freshness/domain filters. Authentication, access, and quota failures are surfaced at the lane level rather than silently treated as successful empty searches.

URLs are normalized and deduplicated. Ranking considers destination/topic relevance, source type, and publication recency. Selection prioritizes lane and publisher diversity, then relaxes publisher limits if needed to fill the candidate budget. Those publisher limits are preferences, not a guarantee of independent corroboration.

Up to 20 webpage candidates are extracted in parallel batches of at most ten URLs each. A snippet can remain as a lead when extraction fails, but the source must not be labelled as a fully opened page. Publication dates are provider metadata, not verified facts. Source-type checks match complete hostnames so a lookalike hostname cannot receive a government/news badge solely by containing a trusted name.

## Assessment and provider fallback

1. Gemini is primary when `GEMINI_API_KEY` is nonempty. `GEMINI_MODEL` overrides the current default string, `gemini-3.8-flash`.
2. Groq is attempted when configured if Gemini is missing or fails. Its primary model defaults to `openai/gpt-oss-20b`; a distinct `GROQ_FALLBACK_MODEL` can be configured.
3. If neither provider is configured, or configured providers cannot produce a valid assessment, deterministic review is labelled as rules-based.

Gemini allows one retry for transient server/network/timeout failures, but does not retry HTTP 429 quota errors. Groq allows one transient retry on its primary model; a configured alternate can be tried for an unavailable model or exhausted transient failures. Quota/authentication/malformed-request errors do not trigger a retry loop. Each provider receives a bounded evidence selection, not necessarily every full page collected.

Prompts treat retrieved text as untrusted evidence and require citations. Assessment JSON must contain an issues array; normalized findings need valid source IDs and a positive bounded score. Duplicates are consolidated and at most ten normalized findings are returned. These checks constrain output but do not independently fact-check the model. Provider/model names and fallback metadata accompany results.

Default identifiers are documented to match the code, not endorsed as universally available models. Model access, schemas, pricing, and quotas need verification for the actual provider account.

## Weather and date coverage

The confirmed place feeds daily forecast and river-discharge requests while web search runs. The daily request asks for a 16-day horizon; the flood request asks for 210 days. These are requested horizons, not guarantees that usable data will be returned for every location or date.

Only usable daily records inside the selected trip window count. Out-of-window dates are never substituted to make a forecast appear available. Daily coverage reports the total trip days, matched days, `complete`/`partial`/`unavailable` status, and contiguous missing date ranges. Missing ranges are derived from the returned records without allocating a day-by-day list for arbitrarily long trips.

Daily forecasts and river-discharge availability are separate. River flow is nearest-grid model output and cannot establish that a particular road or local river will flood. Open-Meteo requests are serialized with a 1.5-second gap and a bounded ten-minute response cache; rate-limit backoff remains subject to the calling job's budget. An optional external Worker can provide the same three supported routes.

Deterministic signals screen precipitation, gusts, heat, snowfall, thunderstorms, and rising river discharge. These are operational thresholds, not official warning criteria. Weather issues merge with valid assessed issues, keeping a stronger deterministic signal from being suppressed by an invalid or weaker duplicate.

## Coverage is separate from findings

The implementation distinguishes web evidence from weather records. A lane that responds successfully with zero usable results still counts as having responded; inspect result counts as well as lane success totals.

Coverage currently follows these rules in order:

1. No selected web sources, no destination/topic-relevant web sources, or fewer than four successful lanes makes coverage `inconclusive`.
2. Otherwise, no full pages without date-relevant weather, or fewer than two relevant web sources, yields `limited` when date-relevant weather exists and `inconclusive` otherwise.
3. Otherwise, at least six successful lanes and at least `min(6, selected web source count)` opened pages yields `adequate`.
4. Remaining cases are `limited`.

These are collection heuristics. Even `adequate` does not establish complete coverage or a safe destination. Daily forecast gaps are communicated separately and remain visible when signal/source filters are used.

## Risk scoring

`computeOverallScore(issues)` calculates:

```text
0, when there are no normalized issues
otherwise min(100, round(highest issue score + 4 × (number of issues − 1)))
```

For results with findings, the overall bands are:

| Score    | Overall label |
| -------- | ------------- |
| Below 35 | Low signal    |
| 35–59    | Elevated      |
| 60–79    | High          |
| 80–100   | Critical      |

These labels are heuristic triage bands, not probabilities of harm, validated risk forecasts, or government classifications. Per-issue confidence and source freshness are separate metadata; neither is a direct term in the overall formula. Individual issue severity may come from the assessed issue rather than the overall-score band.

Rules-based starting scores are 68 for environmental alerts, 64 for civil unrest, 52 for transport, 48 for standing restrictions, 44 for health, and 28 for microcrime. Without a selected-date/current-time cue, a fallback issue's score is capped at 38. These constants and the independent weather thresholds should change only with corresponding documentation and regression coverage.

## Budgets, shared work, and cancellation

A distinct scan receives a 100-second overall budget. Stage limits include seven seconds per search request, twenty seconds per extraction batch, and twelve seconds per AI request. Location lookup jobs have a separate 25-second budget. Stage retries, provider fallbacks, and weather queueing do not extend the overall job budget. The browser allows 108 seconds for its request; Vite's API proxy timeout is 110 seconds.

Identical requests for the same confirmed place and dates share one active job. The job's budget begins when it starts, not when a later subscriber joins. Each request subscribes independently: cancelling one does not stop work needed by others; cancelling the last aborts upstream work. Failed or cancelled jobs do not enter the completed-result cache. A cached scan retains its original collection timestamp; a short request duration does not mean new evidence was collected.

Defaults are six scan requests per client IP per ten minutes, three distinct scans at once, and up to 100 subscribers per job. Completed scans are cached for 45 seconds. Lookups have separate limits of twenty requests per IP per minute, four distinct jobs, and nine-minute completed-result caching. Shared and cached requests still consume the client's request allowance. HTTP 429 responses include retry guidance.

All limits, pending jobs, caches, and confirmations are in memory. They reset on restart and do not coordinate replicas. IP limits depend on correctly configured trusted proxies. This keeps the prototype simple; multiple replicas need a shared limiter/job store or appropriate gateway controls.

## Interface and local planning state

The interface uses flat ivory, forest-green, and terracotta surfaces, serif display headings, and a persistent light/dark preference. Motion uses CSS transitions/animations and respects reduced-motion settings. The current UI does not use GSAP, even though the dependency remains in the manifest.

Notebook saves are explicit and bounded to six plans. Only destination, dates, and a local deduplication ID are saved; assessment results, risk scores, and server location IDs are excluded. Restoring a past plan shifts its start to today while preserving duration and requires fresh confirmation before scanning.

Theme preferences and checklist state are stored locally. Changing a place or dates resets the checklist. Checkmarks are personal reminders, not evidence of safety and not inputs to scoring. If storage is unavailable, the UI falls back to state for the current visit rather than blocking trip planning. Browser storage is origin-specific and can be cleared; there is no account sync.

Signal filters and source search only change the view. Text downloads always include the full scan's findings, sources, coverage, forecast gaps, and limitations. Print reflects the visible filtered view and explicitly says so. Neither output is an official advisory.

## Data handling and credentials

API credentials are server-side environment values. The browser sends trip details to Express; Express sends destination queries to search providers, selected URLs to extraction, coordinates to weather services, and selected evidence/trip context to the configured assessment provider. An external weather proxy adds that service to the weather request path. A health flag means a value is configured, not that it was authenticated successfully.

Local `.env` files and test/build outputs are ignored. Real credentials belong in environment or Worker secret settings, never committed files. Downloaded briefings contain destination, dates, findings, and links; users should decide where to store or share them.

## Validation and remaining evaluation

Node tests exercise request/JSON validation, citations, provider fallback, weather dates, shared jobs, cancellation, rate limits, plan persistence helpers, date shortcuts, and text export. Playwright covers the built UI, confirmation, cancellation, themes, storage failure, filters, downloads, printing, and responsive widths. CI runs these checks on pushes and pull requests using Node.js 24.

Fixtures make regression tests repeatable without live credentials. They do not demonstrate live provider availability, model quality, security under hostile traffic, or deployment readiness. Retrieval quality, location accuracy, multilingual coverage, and score calibration still require independent evaluation.
