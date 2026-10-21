import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const serverPath = path.join(root, 'server', 'index.js');
const envExamplePath = path.join(root, '.env.example');

for (const file of [serverPath, envExamplePath]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(root, file)}. Run this script from the TraceRisk repository root.`);
    process.exit(1);
  }
}

let server = fs.readFileSync(serverPath, 'utf8').replace(/\r\n/g, '\n');
let envExample = fs.readFileSync(envExamplePath, 'utf8').replace(/\r\n/g, '\n');

if (server.includes('OPEN_METEO_PROXY_URL')) {
  console.error('server/index.js already contains OPEN_METEO_PROXY_URL. No files were changed. Check whether the proxy integration was already applied.');
  process.exit(1);
}

function replaceExactlyOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Expected exactly one match for ${label}; found ${first < 0 ? 0 : 'more than one'}. No files have been written. Your source may differ from current public main.`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

try {
  server = replaceExactlyOnce(
    server,
    "const OPEN_METEO_CACHE_TTL_MS = 10 * 60 * 1_000;\n",
    "const OPEN_METEO_CACHE_TTL_MS = 10 * 60 * 1_000;\nconst OPEN_METEO_PROXY_URL = (process.env.OPEN_METEO_PROXY_URL || '').replace(/\\/+$/, '');\n",
    'Open-Meteo constants'
  );

  server = replaceExactlyOnce(
    server,
    "    weatherProvider: 'Open-Meteo (automatic geocoding; no key; non-commercial use)',\n",
    "    weatherProvider: 'Open-Meteo (automatic geocoding; no key; non-commercial use)',\n    weatherProxyMode: OPEN_METEO_PROXY_URL ? 'Cloudflare Worker' : 'Direct Open-Meteo',\n    weatherProxyConfigured: Boolean(OPEN_METEO_PROXY_URL && process.env.OPEN_METEO_PROXY_TOKEN),\n",
    'health endpoint weather provider field'
  );

  const functionNeedle = "async function openMeteoJson(\n  url,\n  options = {},\n  timeoutMs = OPEN_METEO_TIMEOUT_MS\n) {";
  const helper = `function getOpenMeteoRequestUrl(url) {
  if (!OPEN_METEO_PROXY_URL) return String(url);

  const original = new URL(String(url));
  const routeByEndpoint = {
    'geocoding-api.open-meteo.com/v1/search': '/geocoding/search',
    'api.open-meteo.com/v1/forecast': '/forecast',
    'flood-api.open-meteo.com/v1/flood': '/flood',
  };
  const route = routeByEndpoint[
    \`${'${original.hostname}${original.pathname}'}\`
  ];
  if (!route) throw new Error('Unsupported Open-Meteo endpoint');

  const proxied = new URL(route, \`${'${OPEN_METEO_PROXY_URL}/'}\`);
  original.searchParams.forEach((value, key) => {
    proxied.searchParams.set(key, value);
  });
  return proxied.toString();
}

`;
  server = replaceExactlyOnce(server, functionNeedle, helper + functionNeedle, 'Open-Meteo URL mapper insertion point');

  const oldCall = `        const data = await fetchJson(
          url,
          {
            ...options,
            _skip429Retry: true,
          },
          timeoutMs
        );`;
  const newCall = `        const requestUrl = getOpenMeteoRequestUrl(url);
        const requestOptions = { ...options, _skip429Retry: true };

        if (OPEN_METEO_PROXY_URL) {
          const token = process.env.OPEN_METEO_PROXY_TOKEN;
          if (!token) {
            throw new Error(
              'OPEN_METEO_PROXY_TOKEN is required when OPEN_METEO_PROXY_URL is configured'
            );
          }
          requestOptions.headers = {
            ...(options.headers || {}),
            Authorization: \`Bearer \${token}\`,
          };
        }

        const data = await fetchJson(requestUrl, requestOptions, timeoutMs);`;
  server = replaceExactlyOnce(server, oldCall, newCall, 'openMeteoJson fetch call');

  envExample = replaceExactlyOnce(
    envExample,
    'GROQ_FALLBACK_MODEL=\n\n# Optional\nPORT=8787\n',
    'GROQ_FALLBACK_MODEL=\n\n# Optional Cloudflare Worker proxy for Open-Meteo. Leave blank for direct API requests.\nOPEN_METEO_PROXY_URL=\nOPEN_METEO_PROXY_TOKEN=\n\n# Optional\nPORT=8787\n',
    '.env.example optional settings block'
  );
} catch (error) {
  console.error(`Update aborted: ${error.message}`);
  process.exit(1);
}

// Keep originals as backups before writing anything.
const serverBackup = `${serverPath}.before-cloudflare-proxy.bak`;
const envBackup = `${envExamplePath}.before-cloudflare-proxy.bak`;
if (fs.existsSync(serverBackup) || fs.existsSync(envBackup)) {
  console.error('Backup file already exists. Move/remove the old backup before applying, so your original files are not overwritten. No files were changed.');
  process.exit(1);
}

fs.copyFileSync(serverPath, serverBackup);
fs.copyFileSync(envExamplePath, envBackup);
fs.writeFileSync(serverPath, server, 'utf8');
fs.writeFileSync(envExamplePath, envExample, 'utf8');

console.log('TraceRisk Open-Meteo proxy integration applied.');
console.log('Backups created:');
console.log(`  ${path.relative(root, serverBackup)}`);
console.log(`  ${path.relative(root, envBackup)}`);
console.log('Next run: node --check server/index.js && npm run build');
