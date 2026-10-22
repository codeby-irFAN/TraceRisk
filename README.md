# TraceRisk

**The travel field guide for India.**

[![CI](https://github.com/codeby-irFAN/TraceRisk/actions/workflows/ci.yml/badge.svg)](https://github.com/codeby-irFAN/TraceRisk/actions/workflows/ci.yml)

TraceRisk turns local reports, official advisories, and forecast data into a source-linked briefing for an Indian destination and travel dates. Confirm the right city and state, review what may affect your journey, and keep a copy of the evidence and its limitations.

> TraceRisk is a prototype for travel awareness, not an official safety rating, emergency service, or guarantee of safety. Confirm important conditions with official authorities and transport operators.

[Demo recording](https://drive.google.com/file/d/1RIJOVODbjnc7rzDPaioiRQqtznZLq5oE/view?usp=drivesdk) · [Engineering decisions](DECISIONS.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Evaluation](docs/EVALUATION.md) · [Contributing](CONTRIBUTING.md) · [Azinhack brief](AZINHACK_SUBMISSION.md)

Use this README for the current workflow; the recording is a separate demonstration.

## What you can do

- **Plan a trip:** choose destination suggestions or enter a place, use date shortcuts, and explicitly confirm the resolved city, district, and state.
- **Keep a notebook:** save up to six trip plans in the current browser, reopen or remove them, and use a personal preparation checklist. Saved plans contain trip details, not previous safety assessments.
- **Review eight search categories:** traffic and roads, public transport, civil unrest, official advisories, health, crime, infrastructure, and regional news.
- **Inspect the evidence:** open source links, distinguish full pages from snippets, see government-domain and publication-date badges, and search or filter the source list.
- **Understand the weather window:** see daily forecasts and modelled river flow, the number of trip days covered, and the exact dates without daily forecasts.
- **Get useful results from sparse searches:** review local source leads, date-matched weather, and official next checks even when no disruption is established.
- **Explore findings:** filter signals by category and sort them by score or confidence while keeping coverage warnings visible.
- **Keep your briefing:** download the complete findings and source links as text, or print the current filtered view with its limitations.
- **Control the experience:** cancel a lookup or scan, switch between daylight and evening themes, and use the responsive interface with keyboard navigation and reduced-motion support.

The visual theme uses flat ivory, forest green, and terracotta surfaces, with a generated map-pin and route emblem shared by the header, footer and favicon. The frontend uses React 19, Vite 7, Lucide icons, and CSS transitions; the backend uses Express 5 on Node.js.

<details>
<summary>View the current interface</summary>

Interface previews, not evidence of a successful live provider scan. Connection indicators are illustrative.

### Daylight

![TraceRisk trip planner with an ivory canvas, destination and date fields, saved-plan notebook, and checklist](graphics/screenshots/desktop-light.png)

### Evening

![TraceRisk trip planner in its dark forest-green theme](graphics/screenshots/desktop-dark.png)

### Mobile

<img src="graphics/screenshots/mobile-light.png" alt="TraceRisk mobile layout with trip planner, notebook, and preparation checklist" width="320" />

</details>

## Run locally

Use **Node.js 24** for the same major version as CI. The package supports Node.js **20.19+ in the 20.x line, or 22.12+**. Run these commands from the repository root:

```sh
git clone https://github.com/codeby-irFAN/TraceRisk.git
cd TraceRisk
npm ci
```

Copy the configuration template once, preserving any existing `.env`:

```sh
# macOS / Linux
cp -n .env.example .env
```

```powershell
# Windows PowerShell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` before starting:

| Setting            | Needed for                                                                          |
| ------------------ | ----------------------------------------------------------------------------------- |
| `TINYFISH_API_KEY` | Live search and webpage extraction; without it, weather and next checks still work. |
| `GROQ_API_KEY`     | Optional AI quotation selection; the only supported AI provider.                    |
| `GROQ_MODEL`       | Optional model overrides; see [configuration](docs/DEPLOYMENT.md#configuration).    |

Replace required placeholders with valid credentials. Leave unused optional credentials blank; known placeholder values are treated as missing. Configuration flags still do not validate real credentials. Get keys through [TinyFish](https://agent.tinyfish.ai/), [Groq Console](https://console.groq.com/keys). Keep real credentials in local or deployment settings, never in Git.

Open-Meteo geocoding is needed to confirm a destination. Its public non-commercial geocoding, forecast, and flood endpoints do not require an API key. The optional external proxy is described in the [deployment guide](docs/DEPLOYMENT.md#optional-cloudflare-worker-proxy).

```sh
npm run dev
```

The frontend starts at `http://127.0.0.1:5173`; Express defaults to port `8787`. Vite forwards `/api` requests to the backend and follows a custom `PORT` setting. Backend watch mode and Vite reload development changes. Stop both with `Ctrl+C`.

1. Enter a destination and travel dates; shortcuts fill the form without starting a request.
2. Select **Find destination**, then choose the correct location.
3. Select **Check my trip**. The backend has a 20-second processing budget; slow providers yield partial results. Hosting cold starts and network time are additional. **Cancel scan** stops waiting.
4. Read the source-coverage warning, findings, weather gaps, and supporting links.
5. Download the complete briefing or print the current view. Recheck official information close to departure.

`GET /api/health` reports server configuration without returning keys. Configuration flags do not validate credentials, quota, model availability, or upstream connectivity.

## How collection and assessment work

```text
Trip planner
  ├── GET /api/locations → user confirms a server-resolved place
  └── POST /api/analyze → request limits, shared work, and short-lived cache
       ├── 8 TinyFish search lanes + broader retry where appropriate
       ├── Open-Meteo forecasts for the confirmed coordinates
       ├── Deduplicate and select up to 12 relevant webpages
       ├── Extract each page independently in parallel
       ├── Optional Groq quotation selection + deterministic evidence checks
       └── Checked quotations + useful source leads + forecasts + next checks
```

Source-supported findings require fetched text, a matching place and date evidence. AI cannot invent the displayed facts or choose their scores. Groq is the only AI provider. It is optional: deterministic evidence checks remain available when its key is missing or a request fails. Weather thresholds supplement the assessment. Default model identifiers are implementation settings, not a guarantee that a provider currently offers them to every account.

Collection status is `adequate`, `limited`, or `inconclusive`. These describe evidence coverage, not destination safety. A score of zero or an empty issue list is not an all-clear. The heuristic overall score and its limitations are explained in [DECISIONS.md](DECISIONS.md#risk-scoring).

By default, scan protection allows six requests per client IP per ten minutes and three distinct concurrent scans per Node process. Identical requests can share provider work, and completed results are cached for 60 seconds. These controls, including proxy/IP assumptions and multi-instance limitations, are detailed in [deployment](docs/DEPLOYMENT.md#request-limits-and-process-state).

## Development and checks

```sh
npm test
npm run format:check
npm run build
npx playwright install chromium
npm run test:browser
```

Run the build before browser tests; they use the built frontend and a local server on port `4174`. Tests use provider fixtures and do not require live API credentials. They cover backend validation and fallback, cancellations and shared scans, weather date matching, saved plans, themes, filters, exports, and mobile layouts. They do not establish that a live provider account or deployed environment works.

[GitHub Actions](.github/workflows/ci.yml) runs these checks on pushes and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for scripts, browser setup, and change-specific validation.

To measure real provider performance separately from fixture tests:

```sh
npm run benchmark:live -- --live
```

This uses configured provider quota and writes ignored reports under `artifacts/benchmarks/`. See [evaluation](docs/EVALUATION.md) for measured examples and what they do not prove. Groq was not live-tested in this environment because its credential was not configured.

## Repository map

| Location                                                           | Responsibility                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `src/App.jsx`                                                      | Planning workflow, API requests, cancellation, and theme coordination.      |
| `src/components/`                                                  | Notebook, results, evidence filters, issues, weather, and location choices. |
| `src/planning.js`, `src/hooks/useStoredState.js`                   | Plan/date helpers, text export, and browser persistence.                    |
| `server/app.js`, `server/index.js`                                 | HTTP routes, static serving, and server startup.                            |
| `server/analyze.js`                                                | Collection, assessment, and coverage orchestration.                         |
| `server/search.js`, `server/evidence.js`, `server/assessment.js`   | Retrieval, source/quotation verification and optional AI selection.         |
| `server/locations.js`, `server/weather.js`, `server/open-meteo.js` | Confirmed places, forecast signals, and weather transport/cache.            |
| `server/scan-manager.js`, `server/http.js`                         | Rate limits, shared jobs, time budgets, retries, and cancellation.          |
| `tests/`, `e2e/`                                                   | Node regression tests and Playwright browser tests.                         |

## Limitations

Search can miss new, local-language, social-only, or poorly indexed reports. Publication dates, extracted pages, and AI conclusions may be incomplete or wrong. Broader search can return background material; a government-domain badge does not establish that an advisory is current. Forecasts are model-derived, date-limited, and may not represent local conditions or a particular river or route.

Saved plans, theme preferences, and checklist items stay in the current browser; they are not account-synced or guaranteed to survive cleared storage. Server quotas and caches are in memory, not shared between replicas. Travel details and selected evidence are sent to the relevant providers to perform a scan; see the [data-handling decisions](DECISIONS.md#data-handling-and-credentials).

TraceRisk remains a prototype. Use official authorities, emergency services, and transport operators for time-critical decisions.
