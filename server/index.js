import { createApp } from './app.js';
import { createTripStore } from './trip-store.js';
import { createSupabaseStore } from './supabase-store.js';
import { supabaseAuth } from './supabase-auth.js';
const url = process.env.SUPABASE_URL,
  publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (Boolean(url) !== Boolean(publishableKey))
  throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
const useSupabase = Boolean(url && publishableKey);
if (useSupabase && !process.env.SUPABASE_SECRET_KEY)
  throw new Error(
    'Set SUPABASE_SECRET_KEY in the server environment before enabling Supabase trip storage.',
  );
const auth = useSupabase
  ? supabaseAuth({
      url,
      publishableKey,
      siteUrl: process.env.SITE_URL || 'https://tracerisk.onrender.com',
    })
  : null;
const tripStore = useSupabase
  ? createSupabaseStore({
      url,
      publishableKey,
      secretKey: process.env.SUPABASE_SECRET_KEY,
    })
  : createTripStore({
      filename: process.env.TRACERISK_DB_PATH || 'data/tracerisk.sqlite',
    });
const app = createApp({ tripStore, auth });
import { PORT, DEFAULT_GROQ_MODEL, hasCredential } from './config.js';

const server = app.listen(PORT, '0.0.0.0');

server.on('error', (error) => {
  console.error(`[TraceRisk] Could not start server: ${error.message}`);
  process.exitCode = 1;
});

server.on('listening', () => {
  console.log(`TraceRisk server listening on port ${PORT}`);
  if (
    process.env.TRIP_WATCH_ENABLED !== 'false' &&
    tripStore.monitoringAvailable !== false
  )
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
