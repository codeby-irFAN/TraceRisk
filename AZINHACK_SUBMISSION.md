# TraceRisk — Azinhack Project Brief

## Project summary

TraceRisk is a domestic India travel-awareness dashboard that helps a traveller review potential issues for a destination and selected travel dates. It combines category-focused web searches, extracted webpages, weather and river-discharge data, and AI-assisted evidence review into a source-linked briefing.

## Problem

Travel-relevant information is distributed across news reports, transport updates, official advisories, and weather sources. Travellers may have to search across many places and judge whether each result applies to their destination and planned dates.

## Approach

TraceRisk runs targeted searches across eight categories: traffic and roads, public transport, civil unrest, official advisories, health, crime, infrastructure, and regional news. It retries broader queries when focused searches produce no usable URLs, selects and fetches source pages, and gathers Open-Meteo forecast and river-discharge context. Gemini is the primary AI assessment provider, Groq can serve as a configured fallback, and deterministic screening rules can be used if AI providers are unavailable.

## Core features

- Destination- and date-oriented assessment workflow.
- Category-based search and broader retry for empty lanes.
- Source links accompanying reported findings.
- Forecast detail and weather-related screening signals.
- Primary/fallback AI provider strategy with a rules-based fallback.
- Coverage messaging that distinguishes inconclusive evidence from an all-clear.
- Heuristic overall score with documented thresholds and limitations.

## Technology

- React and Vite frontend.
- Node.js and Express backend.
- TinyFish Search and Fetch for web discovery and webpage extraction.
- Google Gemini and optional Groq integration for AI-assisted review.
- Open-Meteo geocoding, forecast, and river-discharge data.

## What makes the design cautious

TraceRisk is designed to show supporting sources and communicate collection limitations. A low score, zero score, or empty issue list is not proof that a destination is safe. Forecast-derived signals are not official warnings, and AI-generated findings can be incomplete or wrong. Users should verify time-critical information with official authorities and local sources.

## Suggested judging walkthrough

1. Start the app and enter an Indian destination with trip dates.
2. Show the source-linked findings and open a supporting source.
3. Show weather and river-discharge context separately from news findings.
4. Explain how the overall score is computed and why it is a heuristic rather than a probability.
5. Show the coverage state and explain that incomplete evidence should not be treated as an all-clear.


## Current limitations

- Search engines may omit new, local-language, or poorly indexed reports.
- Provider outages, quotas, and timeouts may reduce coverage.
- Weather and river data have availability and geographic-coverage limits.
- AI assessments are not independently verified fact determinations.
- The score is a heuristic triage indicator, not a calibrated or officially endorsed model.

## Future work

- Add automated tests for scoring, source deduplication, and failure handling.
- Evaluate retrieval quality against a curated set of historical travel incidents and advisories.
- Improve source freshness checks and explicit publication-date handling.
- Add more languages and stronger location disambiguation.
- Add deployment hardening, rate limiting, and observability before a public production release.
