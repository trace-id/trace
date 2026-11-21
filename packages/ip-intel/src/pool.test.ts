import { describe, expect, it, vi } from 'vitest';
import { createIpIntel } from './combine.js';
import { instrument, pooledSource, type PoolKey, type UsageEvent } from './pool.js';
import { descriptor } from './registry.js';

const ipinfo = descriptor('ipinfo')!;
const proxycheck = descriptor('proxycheck')!;

const key = (id: string, over: Partial<PoolKey> = {}): PoolKey => ({ id, label: id, values: { token: `tok-${id}` }, weight: 1, dailyLimit: null, enabled: true, ...over });
const ctx = { signal: new AbortController().signal };

/** A fetch stub that answers by the token in the URL. */
function stubFetch(answer: (token: string) => { status: number; body?: unknown }): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const token = new URL(u).searchParams.get('token') ?? '';
    calls.push(token);
    const { status, body } = answer(token);
    return new Response(JSON.stringify(body ?? { country_code: 'DE', asn: 'AS3320', as_name: 'DTAG' }), { status });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const pool = (keys: PoolKey[], fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  pooledSource({ ref: 'p1', descriptor: ipinfo, settings: { plan: 'lite' }, keys, fetch: fetchImpl, ...over });

describe('key pool', () => {
  it('splits calls over keys by weight', async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const src = pool([key('a', { weight: 3 }), key('b', { weight: 1 })], fetch);
    for (let i = 0; i < 40; i++) await src.lookup(`8.8.8.${i}`, ctx);
    expect(calls.filter((t) => t === 'tok-a')).toHaveLength(30);
    expect(calls.filter((t) => t === 'tok-b')).toHaveLength(10);
  });

  it('failover uses the first key until it fails', async () => {
    let aDown = false;
    const { fetch, calls } = stubFetch((t) => (t === 'tok-a' && aDown ? { status: 500 } : { status: 200 }));
    const src = pool([key('a'), key('b')], fetch, { strategy: 'failover' });
    await src.lookup('8.8.8.8', ctx);
    await src.lookup('8.8.4.4', ctx);
    expect(calls).toEqual(['tok-a', 'tok-a']);
    aDown = true;
    await expect(src.lookup('1.1.1.1', ctx)).resolves.toMatchObject({ country: 'DE' });
    expect(calls.slice(2)).toEqual(['tok-a', 'tok-b']);
  });

  it('cools a key down after HTTP 429 and uses the other meanwhile', async () => {
    let t = 1_000_000;
    const { fetch, calls } = stubFetch((tok) => (tok === 'tok-a' ? { status: 429 } : { status: 200 }));
    const events: UsageEvent[] = [];
    const src = pool([key('a'), key('b')], fetch, { strategy: 'failover', now: () => t, onUsage: (e: UsageEvent) => events.push(e) });
    await src.lookup('8.8.8.8', ctx);
    await src.lookup('8.8.4.4', ctx);
    expect(calls).toEqual(['tok-a', 'tok-b', 'tok-b']);
    expect(events.map((e) => e.outcome)).toEqual(['rateLimited', 'ok', 'ok']);
    expect(src.poolState().keys[0]).toMatchObject({ id: 'a', coolingUntil: 1_060_000 });
    t += 61_000;
    await src.lookup('1.1.1.1', ctx);
    expect(calls[3]).toBe('tok-a');
  });

  it('cools a key down for longer after an authentication failure and reports it', async () => {
    let t = 0;
    const { fetch } = stubFetch((tok) => (tok === 'tok-a' ? { status: 401 } : { status: 200 }));
    const events: UsageEvent[] = [];
    const src = pool([key('a'), key('b')], fetch, { strategy: 'failover', now: () => t, onUsage: (e: UsageEvent) => events.push(e) });
    await src.lookup('8.8.8.8', ctx);
    expect(events[0]).toMatchObject({ keyId: 'a', outcome: 'authFailed', status: 401 });
    t += 5 * 60_000;
    expect(src.poolState().keys[0]?.coolingUntil).not.toBeNull();
    t += 6 * 60_000;
    expect(src.poolState().keys[0]?.coolingUntil).toBeNull();
  });

  it('respects a key daily limit, then the provider limit, and resets on a new UTC day', async () => {
    let t = Date.UTC(2026, 10, 20, 12);
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const src = pool([key('a', { dailyLimit: 2 }), key('b')], fetch, { strategy: 'failover', now: () => t, dailyLimit: 4 });
    for (let i = 0; i < 4; i++) await src.lookup(`8.8.8.${i}`, ctx);
    expect(calls).toEqual(['tok-a', 'tok-a', 'tok-b', 'tok-b']);
    await expect(src.lookup('9.9.9.9', ctx)).rejects.toThrow('daily limit reached');
    t = Date.UTC(2026, 10, 21, 0, 1);
    await expect(src.lookup('9.9.9.9', ctx)).resolves.toBeDefined();
    expect(src.poolState().usedToday).toBe(1);
  });

  it('counts calls already made today after a restart', async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const src = pool([key('a', { dailyLimit: 5 }), key('b')], fetch, { strategy: 'failover', initialUsed: { a: 5 } });
    await src.lookup('8.8.8.8', ctx);
    expect(calls).toEqual(['tok-b']);
  });

  it('skips disabled keys and fails clearly when none is usable', async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const src = pool([key('a', { enabled: false }), key('b')], fetch);
    await src.lookup('8.8.8.8', ctx);
    expect(calls).toEqual(['tok-b']);
    const none = pool([key('a', { enabled: false })], fetch);
    await expect(none.lookup('8.8.8.8', ctx)).rejects.toThrow('no enabled key');
  });

  it('marks a key broken when its values do not build, and keeps using the others', async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const src = pool([key('a', { values: {} }), key('b')], fetch);
    await src.lookup('8.8.8.8', ctx);
    expect(calls).toEqual(['tok-b']);
    expect(src.poolState().keys[0]).toMatchObject({ id: 'a', broken: 'missing token' });
  });

  it('sends a fixed share of addresses and gives the same address the same answer', async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 200 }));
    const events: UsageEvent[] = [];
    const src = pool([key('a')], fetch, { sharePercent: 30, onUsage: (e: UsageEvent) => events.push(e) });
    const sent = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const ip = `20.1.${Math.floor(i / 250)}.${i % 250}`;
      const before = calls.length;
      await src.lookup(ip, ctx);
      if (calls.length > before) sent.add(ip);
    }
    expect(sent.size).toBeGreaterThan(80);
    expect(sent.size).toBeLessThan(170);
    const ip = [...sent][0]!;
    const before = calls.length;
    await src.lookup(ip, ctx);
    expect(calls.length).toBe(before + 1);
    expect(events.filter((e) => e.outcome === 'skipped').length).toBeGreaterThan(200);
  });

  it('runs providers that need no key with a built-in entry', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', '8.8.8.8': { proxy: 'no', country: 'United States', isocode: 'US' } }), { status: 200 }));
    const src = pooledSource({ ref: 'pc', descriptor: proxycheck, settings: {}, keys: [], fetch: f as unknown as typeof fetch });
    await src.lookup('8.8.8.8', ctx);
    expect(f).toHaveBeenCalledOnce();
    expect(src.poolState().keys).toHaveLength(1);
  });

  it('never puts a key into usage events or errors', async () => {
    const { fetch } = stubFetch(() => ({ status: 500 }));
    const events: UsageEvent[] = [];
    const src = pool([key('a', { values: { token: 'SECRET-TOKEN-123' } })], fetch, { onUsage: (e: UsageEvent) => events.push(e) });
    await expect(src.lookup('8.8.8.8', ctx)).rejects.toThrow();
    expect(JSON.stringify(events)).not.toContain('SECRET-TOKEN-123');
    expect(JSON.stringify(src.poolState())).not.toContain('SECRET-TOKEN-123');
  });
});

describe('instrument', () => {
  it('reports calls of a single-key source', async () => {
    const events: UsageEvent[] = [];
    const ok = instrument({ name: 'x', remote: true, lookup: () => ({ country: 'DE' }) }, { ref: 'env:x', onUsage: (e) => events.push(e) });
    await ok.lookup('8.8.8.8', ctx);
    const bad = instrument({ name: 'x', remote: true, lookup: () => Promise.reject(new Error('boom')) }, { ref: 'env:x', onUsage: (e) => events.push(e) });
    await expect(bad.lookup('8.8.8.8', ctx)).rejects.toThrow('boom');
    expect(events.map((e) => e.outcome)).toEqual(['ok', 'error']);
  });
});

describe('cache across a pooled provider', () => {
  it('sends each address to the provider once, including unknown answers', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const src = pool([key('a')], f as unknown as typeof fetch);
    const intel = createIpIntel({ sources: [src] });
    await intel.lookup('8.8.8.8');
    await intel.lookup('8.8.8.8');
    await intel.lookup('8.8.8.8');
    expect(f).toHaveBeenCalledOnce();
    expect(intel.stats()).toMatchObject({ providerCalls: 1, memoryHits: 2 });
  });
});
