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
    /* Theme storage is optional; authentication uses an HttpOnly cookie. */
  }
}
export async function api(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-TraceRisk-Request': '1',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 204) return {};
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('tracerisk:signout'));
    const error = new Error(data.error || 'Please try again in a moment.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export const when = (value) =>
  value ? new Date(value).toLocaleString() : 'Not checked yet';
export const place = (location) =>
  [...new Set([location?.name, location?.city, location?.admin1])]
    .filter(Boolean)
    .join(', ');
