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
  remote: boolean;
  lookup(ip: string, ctx: LookupContext): IpFacts | Promise<IpFacts>;
}

export interface FetchOptions {
  /** Defaults to the global fetch. Tests pass a stub. */
  fetch?: typeof fetch;
}
