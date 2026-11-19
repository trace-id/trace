/**
 * Allowed-origin entries are exact origins (`https://app.example.com`, `http://localhost:5173`)
 * or a single-level-or-deeper subdomain wildcard (`https://*.example.com`, which does not
 * match the apex), or a native app id (`app:com.example.shop`) for the React Native SDK, which sends no Origin and
 * names its app in X-Trace-App instead. Anything else never matches.
 */

const APP_ENTRY = /^app:[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** True when the app id is listed as `app:<id>`. Native clients can send any header: this scopes a key, it does not authenticate the app. */
export function appAllowed(appId: string | undefined, allowed: readonly string[]): boolean {
  if (!appId || !APP_ENTRY.test(`app:${appId}`)) return false;
  return allowed.includes(`app:${appId}`);
}
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isValidOriginPattern(pattern: string): boolean {
  if (pattern.startsWith('app:')) return APP_ENTRY.test(pattern);
  if (pattern.includes('*')) {
    const m = /^(https?):\/\/\*\.([a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?$/i.exec(pattern);
    return m !== null;
  }
  return normalizeOrigin(pattern) === pattern;
}

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (normalized === null || normalized !== origin) return false;
  const url = new URL(normalized);
  for (const pattern of allowed) {
    if (!pattern.includes('*')) {
      if (pattern === normalized) return true;
      continue;
    }
    const m = /^(https?):\/\/\*\.(.+?)(:\d+)?$/i.exec(pattern);
    if (!m) continue;
    const [, scheme, domain, port] = m;
    if (`${scheme}:` !== url.protocol) continue;
    if ((port ?? '') !== (url.port ? `:${url.port}` : '')) continue;
    if (url.hostname.endsWith(`.${(domain ?? '').toLowerCase()}`)) return true;
  }
  return false;
}
