# Engineering decisions

Version 4 replaces the slow collection/assessment path with bounded parallel retrieval and a source-verification layer. This describes implemented behavior, not a certification of factual accuracy. See [API](docs/API.md), [deployment](docs/DEPLOYMENT.md), and [evaluation](docs/EVALUATION.md).

## Product scope

TraceRisk supports travel planning within India. Every scan provides a briefing, available forecasts, relevant source leads, and next checks. Missing evidence is never an all-clear; reported disruptions and model weather signals remain separate. A source quotation can be checked against a page without independently proving the page's claim.

## Confirm the place before collecting trip evidence

Open-Meteo resolves Indian places; users must select the city/state even when only one choice appears. Opaque confirmation IDs are bound to the original query for ten minutes. Scans use stored coordinates and administrative context, ignoring client-supplied coordinates. IDs can expire on eviction/restart and are process-local, not authentication credentials.

Search uses confirmed city/state context and known city aliases. Explicit conflicting states are rejected; known ambiguous names, including Manali and Rampur, require state evidence. Regional reports are labelled with the region rather than presented as city-specific. Heuristic place matching cannot resolve every ambiguous name; this remains an evaluation priority.

## Search breadth and extraction

Eight simultaneous TinyFish lanes cover traffic, transport, unrest, official advisories, health, crime, infrastructure, and regional travel news. Short queries omit exact trip dates, which previously excluded useful current reporting. A lane tries one broader query when the first returns no usable local travel sources or a transient failure. Authentication/quota failures do not trigger repeated retries.

Travel-topic and place filters reject unrelated committees, recruitment and news-office datelines. Ranking considers place, topic, official domains and freshness. Relative publication ages help ranking only; they do not establish a claim's date. URLs are normalized, tracking parameters removed, and duplicate lane provenance retained. Selection prefers lane diversity and caps each publisher at three documents. Subdomains count together; this is publisher diversity, not proof of corroboration.

Up to twelve pages are extracted concurrently in separate requests. One slow page cannot hold back an entire batch. Extractions preserve the original URL, final redirect URL and publication metadata. Trust badges use the final hostname. Every source records retrieval time and a SHA-256 digest of its retained evidence excerpt. The hash is an integrity/deduplication aid, not a signed archive of the full webpage. Failed extractions remain clearly labelled snippets.

## Assessment and provider fallback

Groq is the only AI provider and optionally selects quotations (`openai/gpt-oss-20b` by default). Without a configured `GROQ_API_KEY`, deterministic verification runs directly. Groq is attempted once with a six-second timeout inside the 6.5-second assessment stage; failures return to deterministic verification without calling another AI provider. `GROQ_MODEL` must be available to the actual account.

AI receives bounded source excerpts as untrusted data. It returns source IDs and exact quotations, not authoritative titles, narratives, scores or confidence percentages. Both AI-selected and deterministic candidate quotations pass the same checks:

1. The source exists and its page was extracted; snippets cannot become scored findings.
2. The quotation occurs in retained source text. Its enclosing sentence is restored to preserve negation and qualifications.
3. The passage contains the confirmed city/state and a recognized travel disruption.
4. It is not explicitly negated, resolved, hypothetical or historical.
5. Complete event dates overlap the trip, or a report published within two calendar days provides context for a trip starting within two days. A month/day can use the year closest to a recent, known publication date only within 45 days of that date; `dateBasis` explicitly identifies this inference. Unresolvable/relative event dates remain leads; recent news is not projected months ahead.

Repeated passages from the same document, category and area collapse to one report, preferring a longer passage with event dates. Different publications may still describe the same incident; the issue count is a count of reports, not unique incidents. Server templates preserve source words and generate bounded heuristic severity. Unsupported or undated reports still appear as reviewable leads when relevant. This favors precision over recall: valid reports can remain unscored when extraction, language, date or location checks are inconclusive. It does not solve misinformation in an otherwise well-formed source.

## Weather and date coverage

Forecast and flood collection start alongside search; page extraction does not wait for weather. Open-Meteo requests run through separate per-host gates of four concurrent requests, with a five-minute cache of at most 200 entries. They have six-second timeouts and no retry loop. Cached records keep their original retrieval timestamp. An optional authenticated external Worker preserves the existing endpoint contract.

Daily requests ask for sixteen forecast days and flood requests for 210 days. Returned availability is what matters. Only usable records inside the trip window count; missing daily dates remain visible. Nearest-grid river flow cannot establish flooding on a particular road or river reach. Existing deterministic thresholds for precipitation, wind, heat, snow, thunderstorms and river rise remain screening heuristics, not official warnings.

## Coverage is separate from findings

`coverageStatus` describes web collection:

- `adequate`: at least four recently dated, fetched, relevant pages from three publishers and three distinct evidence hashes; at least six responding lanes, four with results.
- `limited`: some relevant web evidence, but the above criteria are not met.
- `inconclusive`: no relevant web evidence.

`resultStatus` is `complete` for adequate web coverage, `partial` when any sources were collected, and `unavailable` when none were collected. Complete does not mean every hazard was found or every forecast date is covered. All three states include next checks. Weather coverage is reported independently; inspect it even for complete results.

## Risk scoring

The overall score is zero with no findings; otherwise it is the highest supported issue score. Additional articles cannot inflate a score by repeating an incident. Web categories use fixed values: movement restrictions 64, environmental advisories 60, civil disruption 55, transport 52, health/infrastructure 45, visitor/crime advisories 28. Weather retains its documented code thresholds.

Overall bands are below 35: low signal; 35–59: elevated; 60–79: high; 80–100: critical. They are triage heuristics, not probabilities or calibrated safety ratings. With no findings the UI shows evidence/coverage status instead of calling a destination safe. Legacy numeric confidence remains in the API for compatibility; cards show evidence status rather than an unjustified accuracy percentage.

## Budgets, shared work, and cancellation

| Work                               | Budget                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| Scan manager                       | 20 seconds                                                    |
| Engine, including result assembly  | 19.5 seconds                                                  |
| Eight concurrent search lanes      | 6 seconds each, including up to two 2.7-second attempts       |
| Concurrent extraction              | 5 seconds total, 4.5 seconds per request including queue time |
| Weather, concurrent with retrieval | 8 seconds total                                               |
| Optional assessment                | 6.5 seconds total                                             |
| Confirmed-location lookup          | 8 seconds                                                     |

The worst planned sequential stages total 17.5 seconds, leaving time for assembly. Browser and development proxy timeouts are 25 and 30 seconds. Network transit, hosting cold starts, saturation and event-loop stalls can still increase perceived time; the budget is not a worldwide latency SLA.

Timeouts cover queueing, response-body reads and cancellation, not just initial HTTP headers. JSON responses are capped at 2 MB (100 KB for AI). Failed stages preserve successful stages. The last disconnected subscriber cancels upstream work; another subscriber can keep a shared job alive. Failed, cancelled and wholly unavailable results are not cached. Partial results may be reused for sixty seconds.

Defaults remain six scans per IP per ten minutes, three active scans and at most 100 subscribers per job. Lookups allow twenty requests/minute and four active jobs, with a nine-minute result cache. State is bounded, in memory, and lost at restart. Multi-instance deployments need consistent routing/shared confirmation state plus shared quota controls. Request IDs, stage timings and provider outcomes support diagnosis without storing credentials.

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

## Version 5: follow the trip

The root UI is a persistent trip workspace; `/check` keeps the original destination-check workflow. All seven trip features are implemented together: route/corridor checks, scheduled in-app Trip Watch, actual date/route rechecks, six-stop itineraries, evidence verification, traveller profiles and a branded client-trip desk. An evidence-based assistant uses deterministic retrieval/templates over stored trip evidence, avoiding unsupported chatbot claims. Groq remains the only optional AI provider in the scan engine.

SQLite from Node 24 keeps deployment dependencies small. One signed-in account owns one workspace; scrypt password hashes and hashed cookie sessions provide access. Shared links use separate expiring random tokens. This is a single-instance design with 50 trips per workspace, not enterprise authentication or a distributed scheduler. The free Render host is explicitly unsuitable for durable background monitoring; production requires an always-running host with a retained database disk.

OSRM supplies road geometry and estimated driving time; reverse geocoding names up to two intermediate areas. Geometry is not proof that a road is open. Precise incident markers require source coordinates; unlocated findings stay regional. Checkpoints use the date window of the corresponding itinerary leg. Supported alternatives are rechecked, not ranked as safer on report count. Train/flight routing, real-time traffic and continuous segment coverage remain outside the implemented data coverage.

Changes compare normalized evidence and severity/support, not scan-local source IDs. A missing report becomes `not-observed`; only a current explicit reopening/withdrawal passage about the same event supports `resolved`. Potential corroboration and conflict detection are transparent text heuristics, not independent newsroom verification. US AQI forecasts and nearby GDACS orange/red events add structured context without replacing official local warnings.

Each stop retains the short scan budget; a complete itinerary has a 110-second budget, two active trip jobs and three concurrent scans. Completed evidence can be reused for five minutes; in-flight work is not shared across independently cancellable trip jobs. Public briefings freeze the completed snapshot for seven days, omit client names by default and can be revoked. No email, SMS, push delivery, payments or hotel-ad placement is claimed.

## Version 5.1: accounts and clearer trip planning

Email/password accounts replace the user-facing recovery key and bearer API. Sessions use HttpOnly/SameSite cookies, CSRF-resistant mutation checks, rate-limited asynchronous password hashing, password changes and server-side revocation. Legacy browser ownership credentials are used only to transfer existing trips during registration. SQLite remains free with no extra provider key, but requires persistent hosting. Email verification/reset delivery is not implemented.

Landmarks retain exact coordinates and surrounding-city metadata. Retrieval checks city-wide conditions plus a landmark-specific search lane, and explicitly distinguishes nearby reports from site-specific restrictions. A small landmark directory covers common demonstration attractions; Photon supplies general POIs. The assistant uses stored weather, itinerary dates, evidence and change events, refuses unsupported opening-hour claims and rejects dates outside the saved check window.

The main UI avoids provider terminology, raw coverage states and invalid time placeholders. Detailed evidence stays inspectable. A CARTO basemap replaces the blocked OSM volunteer tile endpoint, the referrer policy permits normal map requests, and tile errors leave usable route/stop overlays and a clear fallback rather than broken tiles. External provider availability is tested separately from fixture-driven UI correctness.

## Version 5.2: Supabase option

The deployment can use Supabase Auth and Postgres while retaining SQLite for local work and existing tests. Supabase SSR manages HttpOnly chunked cookies and PKCE confirmation/recovery flows. The server verifies the signed-in user before selecting that user's workspace. Database functions enforce ownership, revisions, locks, limits and expiring public shares. RLS is enabled and tables have no public client grants. Browser-authenticated RPC writes cannot change trip reports; trusted writes use a server-only secret, which is never returned to the browser or committed. Background scheduling uses that same server credential and still depends on host uptime.

Database operations are asynchronous end-to-end. Per-request Supabase client context survives background scan jobs, and independently signed-in users cannot share token context. Network requests are bounded. An embedded PostgreSQL test compiles/runs the actual migration and verifies ownership/access restrictions, lock/revision handling and public share revocation/expiry. SQLite data is not automatically assigned by an unverified email; the import script requires a reviewed workspace-to-confirmed-Supabase-user mapping and never copies password hashes or old sessions.

A publishable key cannot apply schema migrations or configure Render. Those dashboard actions remain explicit setup steps. The live project was unreachable through this cloud proxy, so local validation is not represented as a successful live Supabase deployment.
