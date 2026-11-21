import { describe, expect, it } from 'vitest';
import { createIpIntel } from './combine.js';
import { buildFromEnv, providersFromEnv } from './env.js';
import { descriptor, needsKey, providerIds, REGISTRY, validateValues } from './registry.js';
import { type IpCacheStore, type IpFacts } from './types.js';

/** Plausible values for each provider's required fields. */
const sample = (id: string): Record<string, string> => {
  const d = descriptor(id)!;
  const values = Object.fromEntries(d.fields.filter((f) => f.required).map((f) => [f.name, f.kind === 'select' ? f.options![0]!.value : 'x']));
  return id === 'ip-api' ? { ...values, allowFreeHttp: 'true' } : values;
};

describe('provider registry', () => {
  it('every provider builds a named source from its required fields', () => {
    for (const d of REGISTRY) {
      const source = d.build(sample(d.id), {});
      expect(source.name, d.id).toBe(d.id);
      expect(source.remote, d.id).toBe(d.remote);
    }
  });

  it('ids are unique, and every field has a unique name and environment variable', () => {
    expect(new Set(providerIds()).size).toBe(REGISTRY.length);
    const envs = REGISTRY.flatMap((d) => d.fields.map((f) => f.env));
    expect(new Set(envs).size).toBe(envs.length);
    for (const d of REGISTRY) expect(new Set(d.fields.map((f) => f.name)).size, d.id).toBe(d.fields.length);
  });

  it('secrets are never provider-scope settings, and selects list their options', () => {
    for (const d of REGISTRY) {
      for (const f of d.fields) {
        if (f.secret) expect(f.scope, `${d.id}.${f.name}`).toBe('key');
        if (f.kind === 'select') expect(f.options?.length, `${d.id}.${f.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('reads environment variables as before and names the missing one', () => {
    expect(providersFromEnv({ IP_PROVIDERS: 'ipinfo, proxycheck', IPINFO_TOKEN: 't' }).map((s) => s.name)).toEqual(['ipinfo', 'proxycheck']);
    expect(() => providersFromEnv({ IP_PROVIDERS: 'ipinfo' })).toThrow('IP_PROVIDERS: ipinfo: missing IPINFO_TOKEN');
    expect(() => providersFromEnv({ IP_PROVIDERS: 'nope' })).toThrow('unknown provider "nope"');
    expect(() => buildFromEnv(descriptor('maxmind')!, { MAXMIND_ACCOUNT_ID: '1' })).toThrow('missing MAXMIND_LICENSE_KEY');
  });

  it('applies rules across fields', () => {
    const ipApi = descriptor('ip-api')!;
    expect(validateValues(ipApi, {})).toEqual(['Add a pro key, or turn on the free HTTP endpoint']);
    expect(validateValues(ipApi, { allowFreeHttp: 'true' })).toEqual([]);
    expect(validateValues(ipApi, { key: 'k' })).toEqual([]);
  });

  it('knows which providers need a key', () => {
    expect(needsKey(descriptor('ipinfo')!)).toBe(true);
    expect(needsKey(descriptor('proxycheck')!)).toBe(false);
    expect(needsKey(descriptor('cdn-headers')!)).toBe(false);
  });

  it('validates values against the fields', () => {
    const ipinfo = descriptor('ipinfo')!;
    expect(validateValues(ipinfo, { token: 't', plan: 'lite' })).toEqual([]);
    expect(validateValues(ipinfo, { plan: 'lite' })).toEqual(['Access token is required']);
    expect(validateValues(ipinfo, { token: 't', plan: 'gold' })[0]).toContain('must be one of');
    expect(validateValues(descriptor('abuseipdb')!, { key: 'k', minScore: 'abc' })).toEqual(['Blocklist at score must be a number']);
    expect(validateValues(ipinfo, { plan: 'x' }, 'key')).toEqual(['Access token is required']);
  });
});

describe('shared cache', () => {
  const remote = (calls: string[]) => ({
    name: 'p',
    remote: true,
    lookup: (ip: string): IpFacts => {
      calls.push(ip);
      return { country: 'DE' };
    },
  });

  it('is filled after a call and answers for another process', async () => {
    const store = new Map<string, IpFacts>();
    const shared: IpCacheStore = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
    const callsA: string[] = [];
    const callsB: string[] = [];
    const a = createIpIntel({ sources: [remote(callsA)], sharedCache: shared });
    const b = createIpIntel({ sources: [remote(callsB)], sharedCache: shared });
    await a.lookup('8.8.8.8');
    await b.lookup('8.8.8.8');
    expect(callsA).toEqual(['8.8.8.8']);
    expect(callsB).toEqual([]);
    expect(b.stats().sharedHits).toBe(1);
    expect([...store.keys()]).toEqual(['p|8.8.8.8']);
  });

  it('treats a broken store as a miss', async () => {
    const shared: IpCacheStore = { get: () => Promise.reject(new Error('down')), set: () => Promise.reject(new Error('down')) };
    const calls: string[] = [];
    const intel = createIpIntel({ sources: [remote(calls)], sharedCache: shared });
    await expect(intel.lookup('8.8.8.8')).resolves.toMatchObject({ country: 'DE' });
    await expect(intel.lookup('8.8.8.8')).resolves.toMatchObject({ country: 'DE' });
    expect(calls).toEqual(['8.8.8.8']);
  });

  it('keeps answers of different refs apart and never sends private addresses', async () => {
    const calls: string[] = [];
    const lite = { ...remote(calls), ref: 'ipinfo:lite' };
    const core = { ...remote(calls), ref: 'ipinfo:core' };
    const intel = createIpIntel({ sources: [lite, core] });
    await intel.lookup('8.8.8.8');
    expect(calls).toHaveLength(2);
    await intel.lookup('10.0.0.1');
    expect(calls).toHaveLength(2);
    expect(intel.stats().skippedPrivate).toBe(1);
  });

  it('does not cache a failure', async () => {
    let n = 0;
    const flaky = { name: 'f', remote: true, lookup: (): IpFacts => { if (n++ === 0) throw new Error('boom'); return { country: 'FR' }; } };
    const intel = createIpIntel({ sources: [flaky] });
    await expect(intel.lookup('8.8.8.8')).resolves.toMatchObject({ country: null });
    await expect(intel.lookup('8.8.8.8')).resolves.toMatchObject({ country: 'FR' });
  });
});
