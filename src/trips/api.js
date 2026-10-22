export const KEY = 'tracerisk-workspace-key';
let memoryKey = null;
export function stored(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}
export function remember(name, value) {
  try {
    if (value === null) localStorage.removeItem(name);
    else localStorage.setItem(name, value);
  } catch {
    /* The active workspace remains usable in memory. */
  }
}
export function workspaceKey() {
  return memoryKey || stored(KEY);
}
export function storeKey(value) {
  memoryKey = value;
  remember(KEY, value);
}

export async function api(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  key = workspaceKey(),
) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 204) return {};
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}
export const when = (value) =>
  value ? new Date(value).toLocaleString() : 'Not checked yet';
export const place = (location) =>
  [location?.name, location?.admin1].filter(Boolean).join(', ');
