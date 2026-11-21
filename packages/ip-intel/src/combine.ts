import { type IpInfo } from '@trace-id/signals/types';
import { type HeaderGetter, type IpCacheStore, type IpFacts, type IpIntelSource, type IpIntelStats } from './types.js';
import { isPublicIp } from './util.js';

export interface IpIntelOptions {
  /** Sources in priority order: for country, ASN and location the first that answers wins. */
  sources: IpIntelSource[];
  /** Budget for all remote lookups of one IP, in ms. Past it, missing answers read as "not checked". Default 400. */
  timeoutMs?: number;
  /** How long a remote answer for an IP is reused. Default 24 hours; 0 turns caching off. */
  cacheTtlMs?: number;
  /** Most answers kept in this process's memory. Default 50,000. */
  cacheSize?: number;
  /** A cache shared between processes, checked after memory and filled on every successful answer. */
  sharedCache?: IpCacheStore;
  /**
   * The in-memory cache itself, for callers that rebuild the chain (a provider was added) and want to keep what was
   * learned. Entries are keyed by source ref and address, so a changed source never reads another's answers.
   */
  memory?: Map<string, { at: number; facts: IpFacts }>;
  /** Called when a source fails or times out (once per source per lookup). Default: silent. */
  onError?: (source: string, error: unknown) => void;
  now?: () => number;
}

export interface IpIntel {
  /** Never throws and never takes much longer than the time budget. */
  lookup(ip: string, headers?: HeaderGetter): Promise<IpInfo>;
  readonly sources: readonly string[];
  stats(): IpIntelStats;
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

interface Answer {
  facts: IpFacts;
  /** False when the source failed or timed out: such an answer is used once and never cached. */
  ok: boolean;
}

const refOf = (s: IpIntelSource): string => s.ref ?? s.name;

/**
 * Combines local lists and databases with IP data providers. Local sources answer from memory every time. Remote
 * sources run in parallel within one time budget. Each source's answer for an IP is cached on its own (memory first,
 * then the shared store when there is one), so adding a provider never repeats the calls to the others and an
 * address is sent to a given provider once per TTL. That includes "nothing known" answers. A failing provider never
 * fails the identification: its fields read as "not checked" for that event, and the failure is not cached.
 * Private and reserved addresses are never sent to a provider.
 */
export function createIpIntel(options: IpIntelOptions): IpIntel {
  const { sources, timeoutMs = 400, cacheTtlMs = 24 * 3_600_000, cacheSize = 50_000, sharedCache, onError = () => {}, now = Date.now } = options;
  const memory = options.memory ?? new Map<string, { at: number; facts: IpFacts }>();
  const inflight = new Map<string, Promise<Answer>>();
  const remote = sources.filter((s) => s.remote);
  const stats: IpIntelStats = { lookups: 0, memoryHits: 0, sharedHits: 0, providerCalls: 0, failures: 0, skippedPrivate: 0 };

  const remember = (key: string, facts: IpFacts): void => {
    if (memory.size >= cacheSize) memory.delete(memory.keys().next().value as string);
    memory.set(key, { at: now(), facts });
  };

  const fromCache = async (key: string): Promise<IpFacts | null> => {
    const hit = memory.get(key);
    if (hit && now() - hit.at < cacheTtlMs) {
      stats.memoryHits++;
      return hit.facts;
    }
    if (!sharedCache) return null;
    try {
      const shared = await sharedCache.get(key);
      if (shared) {
        stats.sharedHits++;
        remember(key, shared);
        return shared;
      }
    } catch {
      // A broken store is a miss.
    }
    return null;
  };

  const ask = async (s: IpIntelSource, ip: string, headers: HeaderGetter | undefined, signal: AbortSignal): Promise<Answer> => {
    const key = `${refOf(s)}|${ip}`;
    if (cacheTtlMs > 0) {
      const cached = await fromCache(key);
      if (cached) return { facts: cached, ok: true };
    }
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async (): Promise<Answer> => {
        stats.providerCalls++;
        try {
          const facts = await Promise.race([
            Promise.resolve(s.lookup(ip, { signal, ...(headers ? { headers } : {}) })),
            new Promise<never>((_, reject) => {
              // A cache read can use up the budget before the call starts; an aborted signal never fires again.
              if (signal.aborted) reject(new Error('timed out'));
              else signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
            }),
          ]);
          if (cacheTtlMs > 0) {
            remember(key, facts);
            void sharedCache?.set(key, facts, cacheTtlMs).catch(() => {});
          }
          return { facts, ok: true };
        } catch (err) {
          stats.failures++;
          onError(s.name, err);
          return { facts: {}, ok: false };
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  };

  return {
    sources: sources.map((s) => s.name),
    stats: () => ({ ...stats }),
    async lookup(ip, headers) {
      stats.lookups++;
      const answers = new Map<IpIntelSource, IpFacts>();
      for (const s of sources) {
        if (s.remote) continue;
        try {
          answers.set(s, await s.lookup(ip, { signal: new AbortController().signal, ...(headers ? { headers } : {}) }));
        } catch (err) {
          onError(s.name, err);
        }
      }
      if (remote.length > 0) {
        if (!isPublicIp(ip)) {
          stats.skippedPrivate++;
        } else {
          // One budget for the whole round; a source still waiting when it ends reads as "not checked".
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const results = await Promise.all(remote.map((s) => ask(s, ip, headers, controller.signal)));
            remote.forEach((s, i) => answers.set(s, results[i]?.facts ?? {}));
          } finally {
            clearTimeout(timer);
          }
        }
      }
      return mergeFacts(sources.map((s) => answers.get(s) ?? {}));
    },
  };
}
