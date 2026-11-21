import { type IpInfo } from '@trace-id/signals/types';

/**
 * What one source knows about an IP. Every field is optional: a source reports only what it covers, and a missing
 * field means "not checked", never "no". `vpn: false` from a provider that checked is different from no answer.
 */
export type IpFacts = Partial<Pick<IpInfo, 'tor' | 'datacenter' | 'blocklisted' | 'country' | 'asn' | 'asnOrg' | 'relay' | 'vpn' | 'proxy' | 'location'>>;

/** Request headers, read-only, lower-case names. */
export type HeaderGetter = (name: string) => string | null;

export interface LookupContext {
  /** Aborted when the lookup's time budget runs out. */
  signal: AbortSignal;
  /** Headers of the identify request, for sources that read them (cdnHeaders). */
  headers?: HeaderGetter;
}

/**
 * One source of IP facts: a local list or database (`remote: false`, answered from memory) or a provider's API
 * (`remote: true`, cached and time-limited).
 */
export interface IpIntelSource {
  name: string;
  /**
   * Stable id for caching, usage and the dashboard. Defaults to `name`. Two sources of the same provider with
   * different settings need different refs, so their answers are cached apart.
   */
  ref?: string;
  remote: boolean;
  lookup(ip: string, ctx: LookupContext): IpFacts | Promise<IpFacts>;
}

export interface FetchOptions {
  /** Defaults to the global fetch. Tests pass a stub. */
  fetch?: typeof fetch;
}

/**
 * A cache shared between processes (Redis, for example). Keys are opaque strings; a value is one source's answer for
 * one IP. Implementations must fail soft: a broken store reads as a miss and a failed write is dropped.
 */
export interface IpCacheStore {
  get(key: string): Promise<IpFacts | null>;
  set(key: string, facts: IpFacts, ttlMs: number): Promise<void>;
}

/** Counters since the lookup chain was built. */
export interface IpIntelStats {
  /** Lookups answered, local and remote. */
  lookups: number;
  /** Remote answers served from this process's memory. */
  memoryHits: number;
  /** Remote answers served from the shared store. */
  sharedHits: number;
  /** Calls made to providers (cache misses). */
  providerCalls: number;
  /** Provider calls that failed or timed out. */
  failures: number;
  /** Addresses never sent to a provider (private, loopback, reserved). */
  skippedPrivate: number;
}
