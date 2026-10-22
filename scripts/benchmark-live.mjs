import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeTrip } from '../server/analyze.js';
import {
  findDestinationLocations,
  locationLabel,
} from '../server/locations.js';
import { hasCredential, ENGINE_VERSION } from '../server/config.js';
import { withRequestBudget } from '../server/http.js';

if (!process.argv.includes('--live')) {
  console.error(
    'Usage: npm run benchmark:live -- --live [Delhi Manali Guwahati]',
  );
  console.error(
    'Makes live provider requests using your configured account and quota.',
  );
  process.exit(1);
}
if (!hasCredential('TINYFISH_API_KEY')) {
  console.error(
    'Configure TINYFISH_API_KEY before benchmarking live retrieval.',
  );
  process.exit(1);
}
const names = process.argv.slice(2).filter((arg) => arg !== '--live');
const destinations = names.length
  ? names.slice(0, 10)
  : ['Delhi', 'Manali, Himachal Pradesh', 'Guwahati'];
const results = [];
const directory = resolve('artifacts/benchmarks');
await mkdir(directory, { recursive: true });
const date = new Date().toISOString();
for (const [index, destination] of destinations.entries()) {
  const started = performance.now();
  try {
    const locations = await withRequestBudget(
      () => findDestinationLocations(destination),
      8000,
    );
    if (!locations.length) throw new Error('No Indian location returned.');
    // Benchmark uses the first ranked result; the application requires user confirmation.
    const location = locations[0];
    const lookupMs = Math.round(performance.now() - started);
    const scanStart = performance.now();
    const result = await analyzeTrip({
      destination: locationLabel(location),
      location,
      startDate: date.slice(0, 10),
      endDate: new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10),
    });
    const scanMs = Math.round(performance.now() - scanStart);
    const row = {
      destination: result.destination,
      lookupMs,
      scanMs,
      withinBudget: scanMs < 20000,
      resultStatus: result.resultStatus,
      coverage: result.coverageStatus,
      pagesFetched: result.pagesFetched,
      relevantSources: result.relevantSources,
      issues: result.issues.length,
      leads: result.leads.length,
      forecastDays: result.weather.forecastDaysMatched,
      provider: result.providerUsed,
    };
    results.push(row);
    await writeFile(
      resolve(directory, `scan-${index + 1}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(row));
  } catch (error) {
    const row = {
      destination,
      error: error.message,
      elapsedMs: Math.round(performance.now() - started),
    };
    results.push(row);
    console.log(JSON.stringify(row));
    process.exitCode = 1;
  }
}
await writeFile(
  resolve(directory, 'summary.json'),
  JSON.stringify(
    {
      engineVersion: ENGINE_VERSION,
      measuredAt: date,
      method:
        'Sequential engine calls; no completed-scan cache; weather cache may be warm. Lookup measured separately. No independent factual accuracy measurement.',
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.withinBudget === false)) process.exitCode = 1;
