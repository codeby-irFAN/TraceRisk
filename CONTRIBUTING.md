# Contributing to TraceRisk

Start with the [README](README.md), [engineering decisions](DECISIONS.md), [API reference](docs/API.md), and [deployment guide](docs/DEPLOYMENT.md). This is a travel-awareness prototype: changes should preserve source citations and honest coverage messaging.

## Local workflow

1. Use Node.js 24 and run `npm ci` from the repository root.
2. Copy `.env.example` to a local `.env` only if one does not exist; preserve existing values. Set the TinyFish key for live scans and leave unused optional credentials blank.
3. Start development with `npm run dev`.
4. Confirm the destination before scanning. A saved browser plan does not contain a reusable server confirmation ID.

Provider keys are not needed for the automated fixture tests. For a live scan, use your own authorized provider access and review quotas before repeated requests. Keep credentials and personal downloaded briefings out of commits and screenshots.

## Scripts

| Command                | Purpose                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm ci`               | Install the locked dependency tree.                                                 |
| `npm run dev`          | Run Express watch mode and the Vite development client together.                    |
| `npm run server`       | Start Express; serves the built frontend when `dist/` exists at startup.            |
| `npm run server:watch` | Run the backend with Node watch mode.                                               |
| `npm run client`       | Run Vite with the `/api` development proxy.                                         |
| `npm run build`        | Produce the frontend bundle in `dist/`.                                             |
| `npm run preview`      | Preview built frontend assets; does not start Express or provide the full scan API. |
| `npm test`             | Run the Node regression suite.                                                      |
| `npm run test:browser` | Run Playwright against the built frontend.                                          |
| `npm run format`       | Format source, tests, workflows, and listed runtime configuration.                  |
| `npm run format:check` | Check formatting for those paths.                                                   |

The current format script does not include Markdown. For documentation edits, run the installed Prettier explicitly on the changed Markdown files or directories, for example `npx prettier --write README.md DECISIONS.md AZINHACK_SUBMISSION.md CONTRIBUTING.md docs`.

## Validation

Run the checks affected by the change. Before submitting application changes, use:

```sh
npm test
npm run format:check
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are also missing. Browser tests start the built app on port `4174`; build first and leave that port free. An existing Chromium can be selected through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` instead of downloading another copy.

For example, in a Bash shell:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

In PowerShell, set `$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the actual installed executable before running the browser command.

Node tests cover server validation, sources and scoring, provider fallback, date windows, quotas, shared work, cancellation, planning helpers, and exported text. Browser tests cover confirmation, cancellation/retry, stored plans, themes, storage failure, source/signal filters, downloads, print warnings, and responsive widths. They use provider fixtures and do not establish live upstream or deployed behavior.

[CI](.github/workflows/ci.yml) runs install, Node tests, formatting, build, and Chromium tests on pushes and pull requests with Node.js 24. Do not claim a hosted CI run passed based only on local results. Documentation-only changes need formatting, relative-link/anchor checks, and a review against the implementation rather than unrelated application test runs.

## Change guidelines

- Keep coverage separate from safety: a missing result, zero score, or successful request must not become an all-clear.
- Preserve the distinction between search snippets, extracted pages, government domains, and forecast models. A cited link is not independent verification.
- Keep the confirmed place consistent across search and weather. Do not accept arbitrary client coordinates as a substitute for confirmation.
- Update regression coverage when changing scoring, source selection, provider fallback, cancellation, or rate limits.
- Keep saved plans limited to trip metadata. Do not persist server IDs, credentials, or old risk assessments in the notebook.
- Support keyboard navigation, visible focus, light/dark themes, narrow screens, and reduced motion. Avoid unnecessary provider calls from form shortcuts or save/restore actions.
- Keep risk/forecast limitations in exported text and printed views. Filtering should not hide the overall coverage warning.
- Use the lockfile for dependency changes; do not add generated `node_modules/`, `dist/`, test results, or local `.env` files.

## Documentation to update with behavior changes

| Change                                                                         | Documentation                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| User workflow, features, or stack                                              | `README.md` and, when relevant, `AZINHACK_SUBMISSION.md`.     |
| Scoring, evidence, coverage, fallback, state, or privacy tradeoffs             | `DECISIONS.md`.                                               |
| Routes, fields, status codes, confirmation, or cache behavior                  | `docs/API.md`.                                                |
| Environment settings, hosting, network destinations, proxy contract, or limits | `docs/DEPLOYMENT.md` and `.env.example` when settings change. |
| Scripts, tests, or CI expectations                                             | This guide and the actual workflow/configuration.             |

For screenshots, use known illustrative or fixture data and label it accordingly. Do not present UI previews as evidence of live provider success.

## Pull requests

Describe the concrete problem and resulting behavior, reference any relevant issue, and list the checks actually run. Include responsive/light/dark screenshots for visual changes when helpful. Keep passed, failed, skipped, fixture-based, and live checks distinct. Note changed configuration requirements and any remaining limitations so reviewers can reproduce the result.

## Live retrieval checks

`npm run benchmark:live -- --live` runs explicit, quota-consuming provider checks outside CI. It records lookup/scan latency, coverage and sources under ignored `artifacts/benchmarks/`. Review the actual locations, publication dates and quotations as well as latency. A passing synthetic regression suite is not a measured real-world accuracy rate. See [evaluation](docs/EVALUATION.md).
