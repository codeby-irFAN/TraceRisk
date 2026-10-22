# Configuration and deployment

[README](../README.md) · [API reference](API.md) · [Engineering decisions](../DECISIONS.md)

The repository supports local development and an Express server that serves the Vite build. It contains a Render blueprint and an optional integration contract for an externally deployed weather proxy. Documentation and a passing local test suite do not establish that a particular deployment or live provider account works.

## Configuration

Run commands from the repository root. The server reads existing process variables and the local `.env` through dotenv. Use [.env.example](../.env.example) as the list of settings, replacing required placeholders and leaving unused optional credentials blank.

| Variable                 | Default / purpose                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `TINYFISH_API_KEY`       | Required for web evidence; weather and next checks remain available without it.                      |
| `GROQ_API_KEY`           | Optional credential for the sole AI provider.                                                        |
| `GROQ_MODEL`             | `openai/gpt-oss-20b`, the current primary Groq identifier.                                           |
| `OPEN_METEO_PROXY_URL`   | Empty for direct requests; optional Worker base URL.                                                 |
| `OPEN_METEO_PROXY_TOKEN` | Required whenever a proxy URL is configured. Sent only by the backend to the proxy.                  |
| `PORT`                   | `8787`; hosting platforms can supply their assigned port.                                            |
| `MAX_CONCURRENT_SCANS`   | `3`; accepts positive integers up to `20`.                                                           |
| `SCAN_RATE_LIMIT`        | `6` requests per client per window; accepts positive integers up to `100`.                           |
| `SCAN_RATE_WINDOW_MS`    | `600000`; accepts positive integers up to `86400000`.                                                |
| `TRUST_PROXY_HOPS`       | `0` for direct/local servers; positive integers up to `10` are supported for a fixed proxy topology. |

Invalid scan-limit/proxy-count values fall back to the defaults. `TRUST_PROXY_HOPS=0` uses the direct peer address. Credential and model changes require restarting the server; browser theme and notebook preferences are unrelated to server settings.

Never put secrets in `VITE_*` values or other frontend configuration: Vite can expose such values to the browser bundle. Store production keys in the host's environment/secret settings. Keep real `.env` files, tokens, downloaded personal briefings, and generated build/test outputs out of commits.

## Required destinations

Allow HTTPS access to the providers used by the configured workflow:

| Purpose                         | Hostnames                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Search and extraction           | `api.search.tinyfish.ai`, `api.fetch.tinyfish.ai`                                                      |
| Direct place/weather data       | `geocoding-api.open-meteo.com`, `api.open-meteo.com`, `flood-api.open-meteo.com`                       |
| Groq, when used                 | `api.groq.com`                                                                                         |
| Optional external weather proxy | The hostname in `OPEN_METEO_PROXY_URL`; its Worker needs access to the corresponding Open-Meteo hosts. |

Browser fonts use `fonts.googleapis.com` and `fonts.gstatic.com`; local font fallbacks are available if those requests fail. Package installation and Playwright browser installation have their own registry/download destinations.

Open-Meteo access is required for the UI's location-confirmation step, even when AI review is disabled. Public endpoint usage is subject to the provider's terms, quotas, and non-commercial restrictions; a proxy does not remove those obligations or limits.

## Run the built application

Use Node.js 24 to match CI, or a runtime satisfying the package engine range.

```sh
npm ci
npm run build
npm run server
```

Express binds to `0.0.0.0` on `PORT`, serves `dist/` when it exists at startup, and handles the API on the same origin. Build before starting the process, and restart after configuration changes. A port-binding error exits with a failure status instead of reporting readiness.

Build tools are dev dependencies. If the host sets `NODE_ENV=production` before dependency installation and omits them, install with `npm ci --include=dev` for the build stage. Runtime starts with `npm run server`; `npm run preview` is a Vite asset preview and is not the complete API-backed application.

In development, `npm run dev` starts backend watch mode and Vite. The Vite proxy reads the configured backend `PORT`. Do not run multiple copies against the same ports.

## Latency and commercial operation

The engine budgets twenty seconds per scan, after the HTTP request reaches a running process. The included free Render plan can sleep; cold starts can exceed that target before processing begins. Choose an always-running instance for predictable demonstrations or public operation. No hosting plan was purchased by this change.

Open-Meteo public endpoints are for non-commercial use under the provider's applicable terms. A hotel-ad business requires an appropriate commercial weather contract and endpoint integration; the free endpoint and a proxy do not grant commercial rights. Independently validate report accuracy and multilingual coverage before advertising this as a safety assessment.

In networks that mandate an HTTP proxy, supported recent Node 24 releases can use `NODE_USE_ENV_PROXY=1` with the host's existing `HTTP_PROXY`/`HTTPS_PROXY` configuration. Older runtimes may require an explicitly configured transport. Do not copy proxy credentials into Git. This cloud workspace required that flag for live checks.

## Render blueprint

[render.yaml](../render.yaml) declares a Node web service with:

- Build: `npm ci && npm run build`.
- Start: `npm run server`.
- Health path: `/api/health`.
- Secure manual entry for `TINYFISH_API_KEY` and `GROQ_API_KEY`.
- `TRUST_PROXY_HOPS=1` for the intended Render ingress path.
- `NODE_OPTIONS=--dns-result-order=ipv4first`.

Supply the requested values through Render settings. The blueprint requests the Groq key; optional model/proxy overrides must be supplied separately. Model support must be checked against the configured provider account. Use a supported runtime and make build tools available during installation.

The health endpoint checks server configuration, not upstream authentication or scan success. Validate the deployed application with a real location lookup and representative scan after deployment. Incomplete coverage and provider failures should remain visible; do not treat a reachable homepage as proof that the scan works.

## Optional Cloudflare Worker proxy

The backend supports an external Worker, but this checkout does not contain a Worker implementation or Wrangler deployment configuration. Deploy and review that service separately; do not assume that a generic uploaded proxy script implements the expected contract.

The backend forwards the original query parameters to these fixed routes:

| Worker path         | Corresponding Open-Meteo endpoint                |
| ------------------- | ------------------------------------------------ |
| `/geocoding/search` | `https://geocoding-api.open-meteo.com/v1/search` |
| `/forecast`         | `https://api.open-meteo.com/v1/forecast`         |
| `/flood`            | `https://flood-api.open-meteo.com/v1/flood`      |

Set `OPEN_METEO_PROXY_URL` to the Worker origin and `OPEN_METEO_PROXY_TOKEN` to the shared credential in the backend's secret settings. The backend sends `Authorization: Bearer <configured token>`. Store the corresponding verifier in the Worker's secret settings; the variable name there depends on the Worker implementation.

The Worker must authenticate requests, preserve the JSON/status contract, and restrict forwarding to the intended endpoints rather than accepting arbitrary target URLs. The browser calls Express, not the Worker, and must never receive the shared token. The backend resolves routes from the Worker origin, so a path prefix in its base URL is not preserved.

With both proxy variables blank, direct Open-Meteo requests are used. A configured URL without a token makes those requests fail; `weatherProxyConfigured` only reports the presence of both settings and does not verify the Worker.

## Request limits and process state

Defaults:

| Resource               | Protection                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| Scans                  | 6 requests per IP per 10 minutes; 3 distinct concurrent jobs.                |
| Location lookups       | 20 requests per IP per minute; 4 distinct concurrent jobs.                   |
| Shared job             | At most 100 subscribers; a later subscriber shares the remaining job budget. |
| Completed scan cache   | 60 seconds, up to 100 entries.                                               |
| Completed lookup cache | 9 minutes, up to 100 entries.                                                |
| Location confirmations | Up to 10 minutes, bounded to 1,000 choices.                                  |
| Weather response cache | 5 minutes, up to 200 entries; four concurrent requests per provider host.    |

Cached/shared requests still consume each client's allowance. Rate/capacity failures return HTTP 429 with `Retry-After`. A cancelled subscriber does not cancel a shared job while someone else still needs it. Cancelling the last subscriber stops upstream work; failed/cancelled and wholly unavailable results are not cached. Partial results can be reused for sixty seconds.

State is per process, in memory, and lost at restart. Multiple replicas do not share quotas, active jobs, completed results, or confirmation IDs. Add shared/gateway limiting for aggregate quota protection. Confirmation across replicas additionally needs consistent routing or a shared confirmation store; otherwise a lookup ID issued by one instance can fail validation on another.

## Trusted proxy configuration

`TRUST_PROXY_HOPS` affects Express's client-IP calculation and therefore per-IP limits. Leave it at `0` for a direct local server. Only set a positive count when every supported path to the app has that known number of trusted proxy hops.

The blueprint assumes Render's ingress proxy is the one trusted hop. If adding another edge/proxy or exposing the backend through an alternative path, review the topology before changing this value. Untrusted forwarded headers must not let a caller choose a new identity to bypass limits. Do not blindly trust all proxies.

## Deployment checks

1. Confirm `/api/health` responds and reports the intended configuration; inspect names/flags without exposing values.
2. Use `/api/locations` to resolve and confirm a representative city/state.
3. Run a scan for dates in the available forecast window; inspect citations, collection counts, weather dates, and coverage warnings.
4. Check the actual provider/model used. If expecting AI but receiving rules-based assessment, investigate provider access and quotas.
5. Cancel a request and verify the interface recovers. Check source filtering and briefing download on the deployed origin.
6. Test the configured proxy path when used. Recheck after any key, host, model, or topology change.

The automated suite uses fixtures and remains separate from these live checks. Deployment settings, a saved environment snapshot, a GitHub push, and a passed CI run are distinct events; none alone proves live provider behavior.

## Version 5: persistent Trip Watch

Node.js **24+** is required (`node:sqlite`). `server/index.js` creates the SQLite database at `TRACERISK_DB_PATH` (default `data/tracerisk.sqlite`) and starts the watch worker unless `TRIP_WATCH_ENABLED=false`. The containing directory is created privately; the database, WAL and SHM files are ignored by Git. Back up the database with SQLite's online backup tooling or stop the server before copying its files. Account passwords use salted scrypt hashes. Sessions are stored as SHA-256 token hashes and sent in HttpOnly, SameSite=Lax cookies. Serve production through HTTPS with the correct `TRUST_PROXY_HOPS` so secure cookies work.

The existing Render **free** blueprint remains free and ephemeral. It sleeps and does not retain the default database across redeployments. **It cannot provide durable scheduled monitoring.** For production, configure an always-running service, mount a persistent disk and set `TRACERISK_DB_PATH` to a file on that mount (for example `/var/data/tracerisk.sqlite`). Provisioning a paid plan/disk is a hosting action, not something this repository automatically purchases. Settings displays whether the server uses a file database and whether the watch worker is running; a file database alone does not prove the host retains that file.

Deploy one server instance with its local SQLite disk. Multi-instance workers, distributed scheduling, email/SMS/push delivery, enterprise access roles and billing are not implemented. Watch checks run on a one-minute scheduler with two active trip jobs and three concurrent place scans, so high load can delay the requested check time. Each place scan has its existing engine budget; a complete itinerary has a 110-second budget. The original destination checker keeps its 20-second server budget. After cancellation or failure the previous completed briefing is preserved. Stop dates are ISO calendar dates; watch expiry uses the last trip date at 23:59 UTC.

Additional network access:

| Purpose                  | Destination                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Air quality              | `air-quality-api.open-meteo.com` (CAMS model output; US AQI, not CPCB station observations)                                               |
| Regional disaster alerts | `www.gdacs.org/xml/rss.xml` (orange/red events within 150 km and overlapping trip dates; point marks event location, not impact boundary) |
| Road routing             | `router.project-osrm.org` by default; `ROUTING_BASE_URL` overrides the OSRM-compatible base                                               |
| Corridor place lookup    | `nominatim.openstreetmap.org`; `REVERSE_GEOCODING_URL` overrides the Nominatim-compatible base                                            |
| Browser map tiles        | `a.basemaps.cartocdn.com` through `d.basemaps.cartocdn.com` (default CARTO tiles)                                                         |

Public OSRM, Nominatim, Photon and map background services have usage policies and no project-specific availability guarantee. Reverse lookups are globally serialized at more than one second apart, with bounded caching. Attribution is shown on the map. For commercial/high-volume use, configure appropriate routing, geocoding and tile services and review their policies; the current tile URL is configured in `src/trips/RouteMap.jsx`. Use licensed commercial Open-Meteo access when required; the current free endpoints are for non-commercial use. Hotel advertisements, payments and bookings are not implemented.

The cloud testing proxy rejected live OSRM/GDACS requests with HTTP 403; direct air-quality requests also failed. Their parsing, routing contracts and unavailable-provider behaviour are fixture-tested; live end-to-end availability must be verified on the target host. They fail independently without removing the itinerary or completed evidence.

Users now sign up/sign in with email and password; recovery keys are no longer shown or accepted as API authentication. Email verification and password-reset delivery are not configured. Users can change their password while signed in, which signs out other sessions. Public briefings expire after seven days and can be revoked or replaced. Avoid putting sensitive information in client names or notes; this workspace is not an enterprise client-record system.

## Version 5.1 accounts, landmarks and map setup

Authentication has no additional paid provider, API key or JWT secret. The SQLite file now includes users and sessions; it **must persist** for accounts and trips to survive deployments. The free Render ephemeral filesystem still cannot guarantee that persistence. The session cookie is Secure under HTTPS or `NODE_ENV=production`, HttpOnly and SameSite=Lax, with a 14-day expiry. Mutation requests require a custom header and an accepted Origin. Password hashing is asynchronous scrypt (`N=32768,r=8,p=3`, individual random salts), with bounded concurrent hashing and login rate limits. Session IDs are randomly generated and hashed in the database; changing a password revokes other sessions.

Existing database files migrate automatically by adding users/session tables. When someone registers or signs in using the browser that held their unclaimed legacy workspace, the app submits that stored ownership credential once and links its trips to the new account. Existing trip data is not deleted. Account email is a login identifier; no mail delivery, email verification or forgot-password flow is configured. Do not promise password recovery by email. A backed-up database remains essential.

`PLACE_SEARCH_URL` optionally overrides the Photon-compatible base (default `https://photon.komoot.io`). A six-attraction directory covers Hawa Mahal, Qutub Minar, Taj Mahal, Amber Fort, India Gate and Gateway of India without a network lookup. General places use Photon/OpenStreetMap, with bounded caching and timeouts. City geocoding remains available when landmark lookup fails. Landmark coordinates locate the planned stop; nearby city reports retain their broader scope.

The default browser tiles use CARTO with OpenStreetMap/CARTO attribution. `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` can override the tile template/attribution at build time; these values are public and must not contain secret tokens. The document and tiles use `strict-origin-when-cross-origin` rather than suppressing the map service's required referrer. On repeated tile failures the tile layer is removed, leaving route/stop overlays and an external Maps link instead of an error mosaic. Review your chosen provider's terms/limits for production or commercial use. General Photon and CARTO requests were blocked by this cloud proxy, so their live availability must still be checked on the target host; built-in landmark lookup and map-failure behaviour are tested locally.
