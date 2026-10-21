# TraceRisk — Domestic India Travel Check

TraceRisk is a source-led travel-awareness dashboard for checking a destination in India before a trip. It combines targeted web searches, webpage extraction, weather and river-flow forecasts, and an AI-assisted evidence summary to help travellers review potential issues for their selected dates.

> **Important:** TraceRisk is a prototype for travel awareness, not an official government safety rating, emergency service, or guarantee of safety. Verify important information with official authorities and local sources before travelling.
Demo Video : https://drive.google.com/file/d/1RIJOVODbjnc7rzDPaioiRQqtznZLq5oE/view?usp=drivesdk

## Features

- **Eight risk-focused search lanes:** traffic and roads, public transport, civil unrest, official advisories, health, crime, infrastructure, and regional news.
- **Broader search retry:** a lane with no usable targeted results can retry with a broader query, improving recall when narrow filters miss relevant pages.
- **Webpage extraction:** selects a diverse group of source URLs and fetches them in two batches, up to 20 candidate source pages overall.
- **AI-assisted evidence review:** Google Gemini is the primary provider; Groq is the optional fallback. The result reports which provider/model was used.
- **Weather and flood context:** Open-Meteo geocoding, forecast, and river-discharge data are shown independently of whether the AI identifies a travel issue.
- **Confirmed destinations:** choose the resolved city, district, and state before starting a scan; search and weather use the same selection.
- **Cancellable scans:** stop waiting at any point; shared scans continue for other travellers who still need them.
- **Source-linked findings:** issue cards link back to sources and label government domains, publication dates, older reports, and snippet-only evidence.
- **Explicit weather coverage:** see how many trip days have forecasts and exactly which dates are missing.
- **Honest coverage states:** limited or inconclusive collection is not represented as proof that a destination is safe.
- **Responsive interface:** React, Vite, Lucide icons, and GSAP animation with reduced-motion support.
- **Bounded runtime:** the backend applies stage timeouts and an overall scan budget of about 100 seconds.

## Tech stack

- **Frontend:** React 19, Vite 7, GSAP, Lucide React
- **Backend:** Node.js 20.19+ or 22.12+, Express 5
- **Search and page extraction:** TinyFish Search and Fetch APIs
- **AI review:** Google Gemini (primary), Groq (fallback)
- **Weather/flood context:** Open-Meteo public geocoding, forecast, and flood APIs

## Quick start (Windows / VS Code)

### 1. Install prerequisites

Install **Node.js 20.19+ or 22.12+** and npm. Confirm they are available in the VS Code terminal:

```powershell
node -v
npm -v
```

### 2. Install dependencies

Open the project folder in VS Code, open **Terminal → New Terminal**, and run:

```powershell
npm ci
```

### 3. Configure API keys

Create a local `.env` file from the example:

```powershell
Copy-Item .env.example .env
```

Open `.env` and add your own keys. The keys below are placeholders—replace them with valid credentials.

```dotenv
TINYFISH_API_KEY=your_tinyfish_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
GROQ_FALLBACK_MODEL=
PORT=8787
```

Get credentials from the provider dashboards:

- [TinyFish](https://agent.tinyfish.ai/) — live web search and webpage extraction.
- [Google AI Studio](https://aistudio.google.com/apikey) — Gemini API key.
- [Groq Console](https://console.groq.com/keys) — optional AI fallback key.

`TINYFISH_API_KEY` is required for a scan. `GEMINI_API_KEY` enables the primary AI assessment. `GROQ_API_KEY` is recommended so the backend can attempt a second provider if Gemini is unavailable. With neither AI key configured, the backend can use its rules-based review; a TinyFish key is still required to start a destination scan. Open-Meteo does not require an API key for the public non-commercial endpoints used here.

**Never commit `.env` or paste API keys into source code, screenshots, public issues, or commits.** `.gitignore` excludes `.env` and other `.env.*` files while allowing `.env.example` to be committed.

### 4. Start the app

```powershell
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser. Enter an Indian destination and travel dates, select **Find destination**, choose the city and state, then select **Check my trip**. Use **Cancel scan** to stop a lookup or scan. Stop the services with `Ctrl+C` in the terminal.

### 5. Check backend status

While the app is running, open [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health). The endpoint reports which providers are configured and the active model names; it does not return the API key values.

## Provider behavior

1. **Gemini** is the primary AI review provider when `GEMINI_API_KEY` is configured.
2. **Groq** is attempted if Gemini is unavailable and `GROQ_API_KEY` is configured. Groq can also operate by itself if no Gemini key is configured.
3. A second Groq model can optionally be configured through `GROQ_FALLBACK_MODEL`.
4. If configured AI providers fail, TraceRisk uses a deterministic rules-based review and labels it accordingly rather than claiming an AI result.

Gemini retries transient server/network/timeout failures once. HTTP 429/quota errors are not repeatedly retried against Gemini; the backend can move to Groq when configured. Provider quotas, model availability, pricing, and default model access may change.

## How the risk score works

TraceRisk scores are **screening/triage indicators, not probabilities of harm** and not government classifications. Each issue receives a score from the AI review or deterministic fallback rules. The overall score is then computed from the issue scores:

```text
overall score = min(100, highest issue score + 4 × (number of issues − 1))
```

If there are no issues, the current implementation returns `0`. The overall label is `Low signal` below 35, `Elevated` from 35–59, `High` from 60–79, and `Critical` at 80 or above. Since the AI-generated issue scores are not statistically calibrated, this overall number should not be interpreted as a measured probability or a precise forecast of personal risk. The formula and thresholds are documented in [`DECISIONS.md`](DECISIONS.md).

Weather thresholds are model-based screening signals, **not official IMD warnings**. Weather data availability also depends on the destination being resolved by geocoding and on the forecast provider's coverage.

## Architecture

```text
React + Vite dashboard
  ├── GET /api/locations → traveller confirms a city/state
  └── POST /api/analyze (confirmed location ID + trip dates)
       ├── 8 concurrent TinyFish Search lanes
       ├── broader retry for empty targeted lanes
       ├── Open-Meteo geocoding + forecast + river-discharge context
       ├── source deduplication and category-balanced selection
       ├── TinyFish Fetch (up to 2 batches of 10 URLs)
       ├── Gemini AI evidence review
       ├── Groq fallback if configured
       ├── deterministic rules/weather signal merge
       └── issues + sources + weather + coverage metadata
```


## Scan limits and shared requests

By default, each client IP can make **6 scan requests per 10 minutes**, with at most **3 distinct scans running at once**. Location lookups are limited to 20 requests per IP per minute and 4 concurrent distinct lookups. Busy or rate-limited responses use HTTP 429 with a `Retry-After` header; the interface shows the wait time.

Identical in-flight scans for the same confirmed place and dates share provider work. Completed scans are cached for 45 seconds. Cancelling one request removes that traveller from the shared scan; upstream requests are aborted when nobody is waiting. Cache hits and shared requests still count toward each client's request limit. A scan has at most 100 waiting subscribers.

The scan limits can be adjusted in `.env`:

| Variable | Default | Accepted range |
| --- | --- | --- |
| `MAX_CONCURRENT_SCANS` | `3` | 1–20 |
| `SCAN_RATE_LIMIT` | `6` | 1–100 requests per window |
| `SCAN_RATE_WINDOW_MS` | `600000` | 1–86400000 milliseconds |
| `TRUST_PROXY_HOPS` | `0` | 0–10; 0 uses the direct peer address |

Only set `TRUST_PROXY_HOPS` when the deployment has a known, fixed number of trusted reverse proxies. The Render blueprint sets it to `1` for Render's ingress proxy; local servers keep `0`. Do not expose that proxy-configured backend through a shorter, untrusted network path, since forwarded IPs would become spoofable.

Limits, shared work, cached results, and location confirmations are **per Node process**, reset at restart, and are not coordinated between replicas. Use a shared store or gateway rate limits before scaling to multiple instances. These limits reduce burst usage; provider billing quotas remain separate.

## API location confirmation

1. Request `GET /api/locations?destination=Rampur` and display its `locations` choices.
2. Let the traveller select the correct place. Each choice contains an opaque `id`, a display `label`, and geographic metadata.
3. Send `POST /api/analyze` with `destination` (the same lookup query), `locationId`, `startDate`, and `endDate`. Dates use `YYYY-MM-DD`.

Unconfirmed, invented, expired, or mismatched location IDs return HTTP 400 with `LOCATION_REQUIRED`. Confirmations last up to 10 minutes and may need refreshing after a server restart. Coordinates supplied directly by a client are ignored; the server uses the confirmed provider result for both weather and location-specific searches.

Daily weather metadata includes `tripDays`, `forecastDaysMatched`, `forecastCoverage` (`complete`, `partial`, or `unavailable`), and `forecastMissingDateRanges`. The missing ranges refer to daily forecasts, independently of river-discharge availability. A government-domain badge identifies the website type, not whether an advisory is current; reports older than 30 days are flagged for verification.

## Validation

Before opening a pull request, run:

```powershell
npm test
npm run format:check
npm run build
npx playwright install chromium
npm run test:browser
```

GitHub Actions runs installation, the Node regression suite, formatting, the production build, and Chromium browser tests on pushes and pull requests. Browser tests run against the built frontend, so build before running them locally. They include the confirmation flow, cancellation and retry, partial forecasts, source badges, and six viewport widths. If Chromium is already installed on the machine, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading another copy.

The automated suite uses fixture provider responses, so it runs without API keys. It covers request validation, scan collection and caching, weather date matching, source citations, provider fallback, and request cancellation. A live destination scan still requires a valid TinyFish key and access to the provider endpoints.

Use `npm run format` to format the JavaScript, JSX, CSS, and runtime configuration consistently.

## Code layout

- `server/index.js` starts the server; `server/app.js` defines API routes and static serving.
- `server/analyze.js` coordinates collection, assessment, and coverage reporting.
- `server/search.js`, `server/weather.js`, and `server/assessment.js` contain the provider workflows.
- `server/locations.js` resolves and validates location confirmations; `server/scan-manager.js` manages limits and shared requests.
- `server/open-meteo.js` handles weather-provider transport and caching.
- `server/http.js` handles JSON requests, retries, and cancellation; `server/utils.js` holds shared helpers.
- `src/App.jsx` coordinates the interface; `src/components/` contains date, issue, and weather components.
- `tests/` contains the Node.js regression suite; `e2e/` contains Playwright browser tests.

## Known limitations

- Search indexing may miss new, local-language, social-only, or poorly indexed updates.
- A page appearing in search results does not guarantee that it is current or relevant to the exact travel dates.
- Broader retries may return older/background pages; publication date and context still need review.
- Forecast and river-discharge outputs are model data, not official warnings.
- Provider outages, API quota limits, timeouts, or incomplete source extraction can reduce coverage.
- An empty issue list means only that the collected evidence did not produce issues above the current screening threshold. It does **not** establish that travelling is safe.
- Use official sources and local authorities for travel restrictions, emergency guidance, and time-critical decisions.

