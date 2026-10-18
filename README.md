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
- **Source-linked findings:** issue cards link back to sources and show confidence/coverage context when available.
- **Honest coverage states:** limited or inconclusive collection is not represented as proof that a destination is safe.
- **Responsive interface:** React, Vite, Lucide icons, and GSAP animation with reduced-motion support.
- **Bounded runtime:** the backend applies stage timeouts and an overall scan budget of about 100 seconds.

## Tech stack

- **Frontend:** React 19, Vite 7, GSAP, Lucide React
- **Backend:** Node.js 20+, Express 5
- **Search and page extraction:** TinyFish Search and Fetch APIs
- **AI review:** Google Gemini (primary), Groq (fallback)
- **Weather/flood context:** Open-Meteo public geocoding, forecast, and flood APIs

## Quick start (Windows / VS Code)

### 1. Install prerequisites

Install **Node.js 20 or newer** and npm. Confirm they are available in the VS Code terminal:

```powershell
node -v
npm -v
```

### 2. Install dependencies

Open the project folder in VS Code, open **Terminal → New Terminal**, and run:

```powershell
npm install
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

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in your browser. Enter an Indian destination and travel dates. Stop the services with `Ctrl+C` in the terminal.

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
  └── POST /api/analyze
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


## Validation

Before opening a pull request, run:

```powershell
node --check server/index.js
npm run build
```

## Known limitations

- Search indexing may miss new, local-language, social-only, or poorly indexed updates.
- A page appearing in search results does not guarantee that it is current or relevant to the exact travel dates.
- Broader retries may return older/background pages; publication date and context still need review.
- Forecast and river-discharge outputs are model data, not official warnings.
- Provider outages, API quota limits, timeouts, or incomplete source extraction can reduce coverage.
- An empty issue list means only that the collected evidence did not produce issues above the current screening threshold. It does **not** establish that travelling is safe.
- Use official sources and local authorities for travel restrictions, emergency guidance, and time-critical decisions.

