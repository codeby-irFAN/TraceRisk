import { createApp } from './app.js';
import { createTripStore } from './trip-store.js';
const tripStore = createTripStore({
  filename: process.env.TRACERISK_DB_PATH || 'data/tracerisk.sqlite',
});
const app = createApp({ tripStore });
import { PORT, DEFAULT_GROQ_MODEL, hasCredential } from './config.js';

const server = app.listen(PORT, '0.0.0.0');

server.on('error', (error) => {
  console.error(`[TraceRisk] Could not start server: ${error.message}`);
  process.exitCode = 1;
});

server.on('listening', () => {
  console.log(`TraceRisk server listening on port ${PORT}`);
  if (process.env.TRIP_WATCH_ENABLED !== 'false')
    app.locals.tripService.start();
  console.log(
    `TinyFish: ${hasCredential('TINYFISH_API_KEY') ? 'configured' : 'missing key (.env)'}`,
  );
  console.log(
    'Weather API: Open-Meteo free non-commercial endpoints (automatic geocoding; no API key)',
  );
  console.log(
    `AI review: ${
      hasCredential('GROQ_API_KEY')
        ? `Groq / ${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL}`
        : 'rules-based fallback (configure GROQ_API_KEY)'
    }`,
  );
});

for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    const force = setTimeout(() => process.exit(1), 12000);
    force.unref();
    await app.locals.tripService.stop();
    server.closeAllConnections();
    server.close(() => {
      tripStore.close();
      clearTimeout(force);
    });
  });
