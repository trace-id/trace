import { type ProviderDescriptor } from './registry.js';
import { type FetchOptions, type IpFacts, type IpIntelSource, type LookupContext } from './types.js';
import { ProviderError } from './util.js';

/**
 * `weighted`: spread lookups over the keys in proportion to their weights (smooth weighted round robin), and fall
 * back to the others when one fails. `failover`: always use the first usable key in order; later keys only take
 * over when it is out of quota, rate limited or failing.
 */
export type KeyStrategy = 'weighted' | 'failover';

/**
 * ok: answered. rateLimited / authFailed / error: a failed call (the key cools down after the first two).
 * skipped: left out on purpose by the provider's traffic share.
 */
export type Outcome = 'ok' | 'error' | 'rateLimited' | 'authFailed' | 'skipped';

export interface UsageEvent {
  /** The provider's id in the dashboard, or `env:<name>` for one named in IP_PROVIDERS. */
  providerRef: string;
  /** The key used; null for providers without keys and for skipped lookups. */
  keyId: string | null;
  outcome: Outcome;
  status: number | null;
  latencyMs: number;
  /** A short reason for failed calls. Never contains the key. */
  message?: string;
}

export interface PoolKey {
  id: string;
  label: string;
  /** The key-scope field values (token, license key and so on). */
  values: Record<string, string>;
  weight: number;
  /** Most calls this key may make per UTC day; null for no limit. */
  dailyLimit: number | null;
  enabled: boolean;
}

export interface KeyState {
  id: string;
  enabled: boolean;
  usedToday: number;
  dailyLimit: number | null;
  /** Epoch ms until which the key is skipped after a rate limit or an authentication failure. */
  coolingUntil: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  /** Set when the key's values do not build a working source (for example a missing field). */
  broken: string | null;
}

export interface PoolOptions extends FetchOptions {
  /** Stable id: the provider's id in the dashboard. Used for caching and usage. */
  ref: string;
  descriptor: ProviderDescriptor;
  /** Provider-scope field values (plan, thresholds). */
  settings: Record<string, string>;
  keys: PoolKey[];
  strategy?: KeyStrategy;
  /** Percent of addresses sent to this provider (0 to 100). The same address always gets the same answer. */
  sharePercent?: number;
  /** Most calls per UTC day over all keys; null for no limit. */
  dailyLimit?: number | null;
  /** Calls already made today per key id, so a restart does not reset the counters. */
  initialUsed?: Readonly<Record<string, number>>;
  onUsage?: (event: UsageEvent) => void;
  now?: () => number;
  /** Cool-down after HTTP 429/402 and after 401/403. Defaults: 60 seconds and 10 minutes. */
  cooldownMs?: { rateLimited?: number; authFailed?: number };
}

export interface PooledSource extends IpIntelSource {
  poolState(): { usedToday: number; keys: KeyState[] };
}

const MAX_ATTEMPTS = 3;

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** FNV-1a: a stable bucket 0..99 per address, so the traffic share does not flap between requests. */
function bucket(ip: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function classify(err: unknown): { outcome: Outcome; status: number | null; message: string } {
  const status = err instanceof ProviderError ? err.status : null;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 429 || status === 402) return { outcome: 'rateLimited', status, message };
  if (status === 401 || status === 403) return { outcome: 'authFailed', status, message };
  return { outcome: 'error', status, message };
}

interface Runtime {
  key: PoolKey;
  source: IpIntelSource | null;
  broken: string | null;
  used: number;
  current: number;
  coolingUntil: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

/**
 * One provider with one or more API keys. Chooses a key per lookup by the strategy, skips keys that are disabled,
 * over their daily limit or cooling down, tries the next key when one fails, and reports every call as a usage
 * event. Providers that need no key (proxycheck, ip-api's free endpoint) get a single built-in "no key" entry.
 */
export function pooledSource(o: PoolOptions): PooledSource {
  const { ref, descriptor, strategy = 'weighted', sharePercent = 100, dailyLimit = null, onUsage = () => {}, now = Date.now } = o;
  const cooldown = { rateLimited: o.cooldownMs?.rateLimited ?? 60_000, authFailed: o.cooldownMs?.authFailed ?? 600_000 };
  const keyless = !descriptor.fields.some((f) => f.scope === 'key' && f.required);
  const keys: PoolKey[] = o.keys.length === 0 && keyless ? [{ id: 'default', label: 'No key', values: {}, weight: 1, dailyLimit: null, enabled: true }] : o.keys;

  const runtimes: Runtime[] = keys.map((key) => {
    let source: IpIntelSource | null = null;
    let broken: string | null = null;
    try {
      source = descriptor.build({ ...o.settings, ...key.values }, o.fetch ? { fetch: o.fetch } : {});
    } catch (err) {
      broken = err instanceof Error ? err.message : String(err);
    }
    return { key, source, broken, used: o.initialUsed?.[key.id] ?? 0, current: 0, coolingUntil: 0, lastError: broken, lastErrorAt: broken ? now() : null };
  });

  let day = utcDay(now());
  const rollDay = (): void => {
    const today = utcDay(now());
    if (today === day) return;
    day = today;
    for (const r of runtimes) r.used = 0;
  };

  const usable = (r: Runtime, t: number): boolean =>
    r.key.enabled && r.source !== null && r.coolingUntil <= t && (r.key.dailyLimit === null || r.used < r.key.dailyLimit);

  const totalUsed = (): number => runtimes.reduce((n, r) => n + r.used, 0);

  /** The next key to try, never one already tried for this lookup. */
  const pick = (tried: Set<string>, t: number): Runtime | null => {
    const eligible = runtimes.filter((r) => usable(r, t) && !tried.has(r.key.id));
    if (eligible.length === 0) return null;
    if (strategy === 'failover') return eligible[0] ?? null;
    // Smooth weighted round robin: every key gains its weight, the leader is picked and pays the total back.
    const total = eligible.reduce((n, r) => n + Math.max(1, r.key.weight), 0);
    let best: Runtime | null = null;
    for (const r of eligible) {
      r.current += Math.max(1, r.key.weight);
      if (!best || r.current > best.current) best = r;
    }
    if (best) best.current -= total;
    return best;
  };

  const lookup = async (ip: string, ctx: LookupContext): Promise<IpFacts> => {
    rollDay();
    if (sharePercent < 100 && bucket(ip) >= sharePercent) {
      onUsage({ providerRef: ref, keyId: null, outcome: 'skipped', status: null, latencyMs: 0 });
      return {};
    }
    if (dailyLimit !== null && totalUsed() >= dailyLimit) throw new ProviderError(descriptor.id, 'daily limit reached');

    const tried = new Set<string>();
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const r = pick(tried, now());
      if (!r || !r.source) break;
      tried.add(r.key.id);
      r.used++;
      const started = now();
      try {
        const facts = await r.source.lookup(ip, ctx);
        onUsage({ providerRef: ref, keyId: r.key.id, outcome: 'ok', status: 200, latencyMs: now() - started });
        return facts;
      } catch (err) {
        const c = classify(err);
        const t = now();
        r.lastError = c.message;
        r.lastErrorAt = t;
        if (c.outcome === 'rateLimited') r.coolingUntil = t + cooldown.rateLimited;
        if (c.outcome === 'authFailed') r.coolingUntil = t + cooldown.authFailed;
        onUsage({ providerRef: ref, keyId: r.key.id, outcome: c.outcome, status: c.status, latencyMs: t - started, message: c.message });
        lastError = err;
        if (ctx.signal.aborted) break;
      }
    }
    if (lastError) throw lastError;
    throw new ProviderError(descriptor.id, keys.some((k) => k.enabled) ? 'no usable key (limits reached, cooling down or misconfigured)' : 'no enabled key');
  };

  return {
    name: descriptor.id,
    ref,
    remote: true,
    lookup,
    poolState() {
      rollDay();
      return {
        usedToday: totalUsed(),
        keys: runtimes.map((r) => ({
          id: r.key.id,
          enabled: r.key.enabled,
          usedToday: r.used,
          dailyLimit: r.key.dailyLimit,
          coolingUntil: r.coolingUntil > now() ? r.coolingUntil : null,
          lastError: r.lastError,
          lastErrorAt: r.lastErrorAt,
          broken: r.broken,
        })),
      };
    },
  };
}

/**
 * Wraps a source (one named in IP_PROVIDERS, with a single key from the environment) so its calls are reported as
 * usage events like a pooled provider's.
 */
export function instrument(source: IpIntelSource, o: { ref: string; onUsage: (event: UsageEvent) => void; now?: () => number }): IpIntelSource {
  const now = o.now ?? Date.now;
  return {
    name: source.name,
    ref: o.ref,
    remote: source.remote,
    async lookup(ip, ctx) {
      const started = now();
      try {
        const facts = await source.lookup(ip, ctx);
        if (source.remote) o.onUsage({ providerRef: o.ref, keyId: null, outcome: 'ok', status: 200, latencyMs: now() - started });
        return facts;
      } catch (err) {
        const c = classify(err);
        o.onUsage({ providerRef: o.ref, keyId: null, outcome: c.outcome, status: c.status, latencyMs: now() - started, message: c.message });
        throw err;
      }
    },
  };
}
