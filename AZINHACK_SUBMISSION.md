# TraceRisk — Azinhack project brief

## Summary

**The travel field guide for India.** TraceRisk helps travellers turn scattered local reports, official notices, and forecasts into a source-linked briefing for a confirmed Indian destination and travel dates. A planning notebook, explicit coverage gaps, and a downloadable briefing keep the experience useful before and after a scan.

[Current setup and features](README.md) · [Demo recording](https://drive.google.com/file/d/1RIJOVODbjnc7rzDPaioiRQqtznZLq5oE/view?usp=drivesdk) · [Engineering decisions](DECISIONS.md)

This brief describes the current implementation. The recording is a separate demonstration and is not proof of current provider connectivity.

## The problem

Travel-relevant information is spread across transport updates, government notices, local news, weather forecasts, and regional reporting. A traveller must identify the correct place, compare sources, and judge whether each report applies to their dates. Incomplete information can also be mistaken for an all-clear.

## The approach

TraceRisk first asks the traveller to confirm the resolved city, district, and state. Eight targeted TinyFish search lanes then collect travel-relevant leads alongside Open-Meteo daily forecast and river-discharge data for the same location. The backend selects and extracts source pages, attempts Gemini and optional Groq review, and can fall back to labelled deterministic triage. Findings retain source links and collection context.

The interface uses an ivory, forest-green, and terracotta travel-journal theme with dark mode, keyboard access, responsive layouts, and reduced-motion behavior.

## Implemented features

- Confirmed destinations and date shortcuts, including weekend and next-week plans.
- Up to six browser-saved trip plans and a preparation checklist; restoring a plan requires fresh location confirmation.
- Eight search categories with a broader retry for lanes without usable targeted results.
- Source citations, government-domain badges, publication dates, older-report warnings, and opened-page/snippet distinctions.
- Daily weather coverage shown as matched trip days and exact missing date ranges; river models are presented separately.
- Filterable/sortable signals and searchable source lists without hiding overall coverage warnings.
- Complete text briefing downloads and a printable filtered view with its limitations.
- Cancellable lookup/scan requests, independent subscribers to shared scans, bounded runtime, request limits, and short-lived caching.
- Node regression tests, Playwright browser tests, and GitHub Actions checks.

## Technology

| Layer                    | Implementation                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Interface                | React 19, Vite 7, Lucide React, CSS themes and transitions.                                            |
| Server                   | Node.js and Express 5; Node.js 24 used in CI.                                                          |
| Discovery and extraction | TinyFish Search and Fetch.                                                                             |
| Assessment               | Gemini primary, optional Groq, deterministic fallback.                                                 |
| Place and forecasts      | Open-Meteo geocoding, daily forecasts, and river-discharge models; optional external Worker transport. |
| Verification             | Node's test runner, Playwright/Chromium, Prettier, and production builds.                              |

## Suggested walkthrough

1. Start the app with provider access as described in the [README](README.md). Enter a destination and choose dates or a shortcut.
2. Select **Find destination**, explain the location choices, then confirm the correct city/state. This prevents attaching the wrong place's weather to the trip.
3. Save the plan, toggle evening/daylight mode, and demonstrate the checklist. Explain that local saves contain trip details rather than a past safety verdict.
4. Select **Check my trip**. Show cancellation if useful; start again for a completed briefing. Do not present mocked test output as a live scan.
5. Review the overall collection status before discussing individual signals. Open a cited source, compare snippet versus opened-page badges, and explain old publication dates.
6. Show matched weather days and any missing dates. Describe model-derived hazards and river flow as screening context, not official IMD/flood warnings.
7. Filter findings and search the evidence, then download the complete briefing or print the current view.
8. Explain the [score formula](DECISIONS.md#risk-scoring), provider fallback, and the [automated checks](CONTRIBUTING.md#validation).

A live demo requires a valid TinyFish key, working geocoding/forecast access, and any chosen AI credentials. Health indicators report configuration, not verified upstream success. If live collection fails, demonstrate the error honestly and describe fixture-based regression tests separately.

## Why coverage is part of the product

TraceRisk separates evidence collection from the presence of findings. A zero score, empty issue list, or successful HTTP request is not proof of safety. Even adequate collection is not exhaustive. AI output can be wrong, old advisories can be stale, and forecasts are not official warnings. Users are directed back to authorities and transport operators for important decisions.

## Current limitations

Search may miss new or local-language reporting. Place matching depends on geocoding coverage and user selection. News, extraction, weather, and model access can fail or run out of quota. Rule scores and weather thresholds are heuristics rather than calibrated forecasts. Browser saves are not account-synced; process-local limits/caches do not coordinate multiple server instances.

## Future work

- Evaluate retrieval freshness and location/date relevance against a curated set of travel incidents and standing advisories.
- Add multilingual retrieval and measure coverage rather than assuming translation solves local reporting gaps.
- Validate or revise scoring/confidence against an independently reviewed dataset.
- Introduce shared rate-limit/job storage and deployment observability for multi-instance operation.
- Expand live-provider contract checks without making ordinary CI depend on credentials or paid requests.
- Add broader accessibility testing and user research with travellers.

These are planned improvements, not implemented or validated capabilities. TraceRisk remains a travel-awareness prototype, not an emergency service or official risk assessment.
