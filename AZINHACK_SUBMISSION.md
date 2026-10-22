# TraceRisk — Azinhack project brief

## Summary

**The travel field guide for India.** TraceRisk helps travellers turn scattered local reports, official notices, and forecasts into a source-linked briefing for a confirmed Indian destination and travel dates. A persistent trip workspace follows the journey with multi-city itineraries, route checks, change alerts and shareable evidence.

[Current setup and features](README.md) · [Demo recording](https://drive.google.com/file/d/1RIJOVODbjnc7rzDPaioiRQqtznZLq5oE/view?usp=drivesdk) · [Engineering decisions](DECISIONS.md)

This brief describes the current implementation. The recording is a separate demonstration and is not proof of current provider connectivity.

## The problem

Travel-relevant information is spread across transport updates, government notices, local news, weather forecasts, and regional reporting. A traveller must identify the correct place, compare sources, and judge whether each report applies to their dates. Incomplete information can also be mistaken for an all-clear.

## The approach

TraceRisk first asks the traveller to confirm the resolved city, district, and state. Eight targeted TinyFish search lanes then collect travel-relevant leads alongside Open-Meteo daily forecast and river-discharge data for the same location. The backend selects and extracts source pages, attempts optional Groq review, and can fall back to labelled deterministic triage. Findings retain source links and collection context.

The interface uses an ivory, forest-green, and terracotta travel-journal theme with dark mode, keyboard access, responsive layouts, and reduced-motion behavior.

## Implemented features

- Route map with source-supported event locations, regional findings and up to two dated corridor checks.
- Persistent Trip Watch with configurable checks and meaningful in-app change alerts.
- Actual alternative-road/date rechecks with evidence, forecast coverage and driving-time comparisons.
- Up to six dated stops per itinerary and 50 trips per private workspace.
- Evidence panel with quotations, event-date basis, affected area, publisher support, conflicts and collection time.
- Travel-mode and accessibility/family/air-quality preferences with practical impact guidance.
- Client travel desk, agency branding and seven-day revocable public briefing snapshots.
- Evidence-grounded trip assistant with citations and explicit information limits.
- Existing Quick Check, daily weather/river data, browser notebook, text export and printable views.
- Node regression tests, Playwright browser tests and GitHub Actions checks.

## Technology

| Layer                    | Implementation                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Interface                | React 19, Vite 7, Lucide React, CSS themes and transitions.                                            |
| Server                   | Node.js 24+ and Express 5 with SQLite persistence.                                                     |
| Discovery and extraction | TinyFish Search and Fetch.                                                                             |
| Assessment               | Groq quotation selection, deterministic fallback.                                                      |
| Place and forecasts      | Open-Meteo geocoding, daily forecasts, and river-discharge models; optional external Worker transport. |
| Verification             | Node's test runner, Playwright/Chromium, Prettier, and production builds.                              |

## Suggested walkthrough

1. Create a private workspace and save its recovery key from Settings.
2. Create a trip with an origin, confirmed destination and dates. Add another stop and select the travel mode and relevant needs.
3. Run a check. Show the itinerary and practical departure checks; explain which date windows have forecast coverage.
4. Open Evidence and follow an original source. Explain the event-date basis, source support and any conflicting report.
5. Open Route map. Distinguish itinerary markers, supported incident points and unlocated regional findings. Explain when routing is unavailable.
6. Open What changed and show configurable Trip Watch frequency. New/changed/not-observed/resolved have different meanings; missing a report never proves a disruption cleared.
7. Compare a later departure and, when supplied by the routing provider, a different road option. Discuss coverage and impact rather than claiming fewer reports means safer.
8. Ask the trip assistant about bus travel or departure checks. Follow a citation.
9. Open Travel desk, set agency branding in Settings, and create a briefing link with client-name inclusion off by default. Print/save the briefing as PDF.

Live web retrieval requires a valid TinyFish key and provider access; Groq is optional. A single place retains its short processing budget, while a full itinerary can take up to 110 seconds. Reliable Trip Watch requires an always-running host and persistent disk. The free Render blueprint does not provide durable monitoring. External routing/GDACS live access was blocked by the cloud testing proxy; describe fixture tests separately from live results.

## Why coverage is part of the product

TraceRisk separates evidence collection from the presence of findings. A zero score, empty issue list, or successful HTTP request is not proof of safety. Even adequate collection is not exhaustive. AI output can be wrong, old advisories can be stale, and forecasts are not official warnings. Users are directed back to authorities and transport operators for important decisions.

## Current limitations

Search may miss new or local-language reporting. Place matching depends on geocoding coverage and user selection. News, extraction, weather, and model access can fail or run out of quota. Rule scores and weather thresholds are heuristics rather than calibrated forecasts. Workspace access uses a private recovery key without email recovery or team roles. Process-local limits/caches do not coordinate multiple server instances. Corridor checks sample areas, not every road segment; train/flight routes and live traffic are unsupported.

## Future work

- Evaluate retrieval freshness and location/date relevance against a curated set of travel incidents and standing advisories.
- Add multilingual retrieval and measure coverage rather than assuming translation solves local reporting gaps.
- Validate or revise scoring/confidence against an independently reviewed dataset.
- Introduce shared rate-limit/job storage and deployment observability for multi-instance operation.
- Expand live-provider contract checks without making ordinary CI depend on credentials or paid requests.
- Add broader accessibility testing and user research with travellers.

These are planned improvements, not implemented or validated capabilities. TraceRisk remains a travel-awareness prototype, not an emergency service or official risk assessment.
