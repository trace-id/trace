import { isIP } from 'node:net';
import { type IpLocation, toLocation } from '@trace-id/signals/geo';

/**
 * Private, loopback, link-local, carrier-grade NAT, documentation and other reserved ranges. Never sent to a
 * provider: they say nothing about the visitor and would only leak internal addresses.
 */
const RESERVED_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 4], [0xf0000000, 4],
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return !RESERVED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    if (lower.startsWith('::ffff:')) return isPublicIp(lower.slice(7));
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast, 2001:db8::/32 documentation.
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false;
    return true;
  }
  return false;
}

/** "AS15169", "15169", 15169 → 15169; anything else → null. */
export function parseAsn(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(?:AS)?(\d{1,10})\b/i.exec(v);
  return m ? Number(m[1]) : null;
}

/** A trimmed, length-capped string, or null for blanks and the placeholders some providers use ("N/A", "-"). */
export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === '-' || s.toUpperCase() === 'N/A' || s === 'Unknown') return null;
  return s.slice(0, max);
}

export function country(v: unknown): string | null {
  const s = str(v, 8);
  return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}

export function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'yes' || v === 'true' || v === 1) return true;
  if (v === 'no' || v === 'false' || v === 0) return false;
  return undefined;
}

export function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Location from a provider's fields; null when it gave no coordinates. */
export function location(input: { city?: unknown; region?: unknown; latitude?: unknown; longitude?: unknown; accuracyRadiusKm?: unknown; timezone?: unknown }): IpLocation | null {
  const latitude = num(input.latitude);
  const longitude = num(input.longitude);
  if (latitude === null || longitude === null) return null;
  return toLocation({
    city: str(input.city, 100),
    region: str(input.region, 100),
    latitude,
    longitude,
    accuracyRadiusKm: num(input.accuracyRadiusKm),
    timezone: str(input.timezone, 64),
  });
}

/** Drops unknown (undefined or null) fields, so a merge sees only what the source reported. */
export function facts<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as { [K in keyof T]?: Exclude<T[K], null> };
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}

/** GET a JSON document; throws ProviderError on network errors, non-2xx answers and non-JSON bodies. */
export async function getJson(provider: string, doFetch: typeof fetch, url: string, init: RequestInit & { signal: AbortSignal }): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) }, redirect: 'error' });
  } catch (err) {
    throw new ProviderError(provider, init.signal.aborted ? 'timed out' : err instanceof Error ? err.message : 'network error');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(provider, 'response is not JSON', res.status);
  }
}

export const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
