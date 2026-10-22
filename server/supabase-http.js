export function supabaseFetch(input, init = {}) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.any(
      [init.signal, AbortSignal.timeout(10000)].filter(Boolean),
    ),
  });
}
