# TraceRisk — Engineering decisions

This document records the main implementation choices in the current v3.2 codebase.

## 1. AI provider order

- Gemini is the primary assessment provider when `GEMINI_API_KEY` is configured. The model defaults to `gemini-3.8-flash` and can be changed through `GEMINI_MODEL`.
- Groq is the optional secondary provider. `GROQ_MODEL` defaults to `openai/gpt-oss-20b`; `GROQ_FALLBACK_MODEL` can be used to set another model.
- Gemini retries one transient server/network/timeout failure. Quota/rate-limit errors are not repeatedly retried against Gemini.
- If configured AI providers cannot complete the assessment, the backend can use deterministic rules-based review. Responses and the UI should accurately label the provider/mode used.

## 2. Search and source extraction

Eight TinyFish search lanes cover traffic/roads, public transport, civil unrest, official advisories, health, crime, infrastructure, and regional news. Each lane has a targeted query and can retry with a broader query when it returns no usable source URLs. The broader retry omits strict freshness/domain filters, improving recall but potentially returning older or less-specific results. Authentication and quota failures should be surfaced, not represented as empty search results.

The backend deduplicates URLs and selects source pages across categories before fetching in two parallel batches of up to ten URLs each. Search hits and fetched page content are distinct states; source coverage must reflect actual collection rather than imply every search hit was successfully reviewed.

## 3. Weather and flood context

Open-Meteo geocoding, forecast, and river-discharge feeds run alongside search. Deterministic thresholds may add forecast-screening signals and the UI keeps weather detail visible even when the AI finds no other issues. Model-derived weather signals are not official warnings and should not be described as IMD alerts.

## 4. User-facing coverage and confidence

The dashboard separates potential issues from collection/coverage status and exposes source links and diagnostics. Search failure, insufficient source extraction, or inconclusive coverage must not become an all-clear. Older articles may provide background or standing restrictions but should not automatically be treated as active incidents for selected travel dates.

## 5. Risk scoring

`computeOverallScore(issues)` currently calculates:

```text
0, when there are no issues
otherwise min(100, highest issue score + 4 × (number of issues − 1))
```

The UI label is `Low signal` for scores below 35, `Elevated` for 35–59, `High` for 60–79, and `Critical` for 80 or above. These are heuristic triage bands, not calibrated probabilities, a validated travel-risk model, or official government classifications. Confidence, recency, and source quality are presented separately; they are not direct mathematical inputs in this overall-score formula.

Rules-based fallback starting scores currently include environmental alert 68, civil unrest 64, transport disruption 52, standing travel restriction/security advisory 48, health 44, and microcrime 28. If a fallback finding does not mention the selected travel dates or a current-time cue, the code caps its score at 38. These constants are operational heuristics and should be changed only alongside documentation and validation.

## 6. Timing and responsiveness

The backend applies a 100-second overall request budget. The current limits include approximately 7 seconds per search request, 20 seconds per fetch batch, and 12 seconds per AI request. Eight search lanes run concurrently; the selected source URLs are fetched in two parallel batches. Short stage timeouts leave time for fallback providers and a response with coverage context.

## 7. Privacy and credentials

Provider credentials are read by the server from environment variables. They should never be embedded in frontend code or committed to version control. `.env.example` contains placeholders only; real values belong in the ignored local `.env` file.
