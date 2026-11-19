import { type IpInfo } from '@trace-id/signals/types';
import { type HeaderGetter, type IpFacts, type IpIntelSource } from './types.js';
import { isPublicIp } from './util.js';

export interface IpIntelOptions {
  /** Sources in priority order: for country, ASN and location the first that answers wins. */
  sources: IpIntelSource[];
  /** Budget for all remote lookups of one IP, in ms. Past it, missing answers read as "not checked". Default 400. */
  timeoutMs?: number;
  /** How long a remote answer for an IP is reused. Default 24 hours; 0 turns caching off. */
  cacheTtlMs?: number;
  /** Most IPs kept in the cache. Default 50,000. */
  cacheSize?: number;
  /** Called when a source fails or times out (once per source per lookup). Default: silent. */
  onError?: (source: string, error: unknown) => void;
  now?: () => number;
}

export interface IpIntel {
  /** Never throws and never takes much longer than the time budget. */
  lookup(ip: string, headers?: HeaderGetter): Promise<IpInfo>;
  readonly sources: readonly string[];
}

/** Merges answers. Flags: true if any source says true, false if one checked and none said true, absent otherwise. */
export function mergeFacts(answers: readonly IpFacts[]): IpInfo {
  const first = <K extends keyof IpFacts>(k: K): IpFacts[K] | undefined => answers.find((a) => a[k] !== undefined && a[k] !== null)?.[k];
  const flag = (k: 'tor' | 'datacenter' | 'blocklisted' | 'relay' | 'vpn' | 'proxy'): boolean | undefined => {
    const seen = answers.map((a) => a[k]).filter((v): v is boolean => typeof v === 'boolean');
    return seen.length === 0 ? undefined : seen.includes(true);
  };
  const vpn = flag('vpn');
  const proxy = flag('proxy');
  const relay = flag('relay');
  return {
    // The original IpInfo fields are required booleans: "not checked" reads as false there, as before.
    tor: flag('tor') ?? false,
    datacenter: flag('datacenter') ?? false,
    blocklisted: flag('blocklisted') ?? false,
    country: first('country') ?? null,
    asn: first('asn') ?? null,
    asnOrg: first('asnOrg') ?? null,
    ...(relay !== undefined ? { relay } : {}),
    ...(vpn !== undefined ? { vpn } : {}),
    ...(proxy !== undefined ? { proxy } : {}),
    location: first('location') ?? null,
  };
}

/**
 * Combines local lists and databases with IP data providers. Local sources answer from memory every time. Remote
 * sources run in parallel within one time budget, and their answers are cached per IP. A failing provider never
 * fails the identification: its fields simply read as "not checked" for that event. Private and reserved addresses
 * are never sent to a provider.
 */
export function createIpIntel(options: IpIntelOptions): IpIntel {
  const { sources, timeoutMs = 400, cacheTtlMs = 24 * 3_600_000, cacheSize = 50_000, onError = () => {}, now = Date.now } = options;
  const cache = new Map<string, { at: number; facts: IpFacts[] }>();
  const inflight = new Map<string, Promise<IpFacts[]>>();
  const remote = sources.filter((s) => s.remote);

  const remoteFacts = async (ip: string, headers: HeaderGetter | undefined): Promise<IpFacts[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.all(
        remote.map(async (s) => {
          try {
            const answer = s.lookup(ip, { signal: controller.signal, ...(headers ? { headers } : {}) });
            const raced = await Promise.race([
              Promise.resolve(answer),
              new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true })),
            ]);
            return raced;
          } catch (err) {
            onError(s.name, err);
            return {};
          }
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    sources: sources.map((s) => s.name),
    async lookup(ip, headers) {
      const answers = new Map<IpIntelSource, IpFacts>();
      for (const s of sources) {
        if (s.remote) continue;
        try {
          answers.set(s, await s.lookup(ip, { signal: new AbortController().signal, ...(headers ? { headers } : {}) }));
        } catch (err) {
          onError(s.name, err);
        }
      }
      // Header sources are per request, never cached; IP providers are cached per IP.
      if (remote.length > 0 && isPublicIp(ip)) {
        let facts: IpFacts[];
        const hit = cache.get(ip);
        if (hit && cacheTtlMs > 0 && now() - hit.at < cacheTtlMs) {
          facts = hit.facts;
        } else {
          let pending = inflight.get(ip);
          if (!pending) {
            pending = remoteFacts(ip, headers).finally(() => inflight.delete(ip));
            inflight.set(ip, pending);
          }
          facts = await pending;
          // Only complete answers are cached, so a provider outage is retried on the next request.
          if (cacheTtlMs > 0 && facts.every((f) => Object.keys(f).length > 0)) {
            if (cache.size >= cacheSize) cache.delete(cache.keys().next().value as string);
            cache.set(ip, { at: now(), facts });
          }
        }
        remote.forEach((s, i) => answers.set(s, facts[i] ?? {}));
      }
      return mergeFacts(sources.map((s) => answers.get(s) ?? {}));
    },
  };
}
