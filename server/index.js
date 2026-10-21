import { app } from './app.js';
import { PORT } from './config.js';

const server = app.listen(PORT, '0.0.0.0');

server.on('error', (error) => {
  console.error(`[TraceRisk] Could not start server: ${error.message}`);
  process.exitCode = 1;
});

server.on('listening', () => {
  console.log(`TraceRisk server listening on port ${PORT}`);
  console.log(
    `TinyFish: ${process.env.TINYFISH_API_KEY ? 'configured' : 'missing key (.env)'}`,
  );
  console.log(
    'Weather API: Open-Meteo free non-commercial endpoints (automatic geocoding; no API key)',
  );
  console.log(
    `LLM priority: ${
      process.env.GEMINI_API_KEY
        ? `Gemini primary / ${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}${process.env.GROQ_API_KEY ? ` → Groq fallback / ${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'}` : ' (no Groq fallback configured)'}`
        : process.env.GROQ_API_KEY
          ? `Groq only / ${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'} (add GEMINI_API_KEY to enable Gemini primary)`
          : 'rules-based fallback (configure GEMINI_API_KEY and/or GROQ_API_KEY)'
    }`,
  );
});
