import { app } from './app.js';
import {
  PORT,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  hasCredential,
} from './config.js';

const server = app.listen(PORT, '0.0.0.0');

server.on('error', (error) => {
  console.error(`[TraceRisk] Could not start server: ${error.message}`);
  process.exitCode = 1;
});

server.on('listening', () => {
  console.log(`TraceRisk server listening on port ${PORT}`);
  console.log(
    `TinyFish: ${hasCredential('TINYFISH_API_KEY') ? 'configured' : 'missing key (.env)'}`,
  );
  console.log(
    'Weather API: Open-Meteo free non-commercial endpoints (automatic geocoding; no API key)',
  );
  console.log(
    `LLM priority: ${
      hasCredential('GEMINI_API_KEY')
        ? `Gemini primary / ${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}${hasCredential('GROQ_API_KEY') ? ` → Groq fallback / ${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL}` : ' (no Groq fallback configured)'}`
        : hasCredential('GROQ_API_KEY')
          ? `Groq only / ${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL} (add GEMINI_API_KEY to enable Gemini primary)`
          : 'rules-based fallback (configure GEMINI_API_KEY and/or GROQ_API_KEY)'
    }`,
  );
});
