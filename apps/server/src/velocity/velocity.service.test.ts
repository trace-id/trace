import { describe, expect, it } from 'vitest';
import { type RedisService } from '../infra/redis.service.js';
import { VelocityService } from './velocity.service.js';

/** Enough of ioredis for the velocity pipeline: counters, exact sets standing in for HyperLogLog, and mget. */
function fakeRedis(): RedisService {
  const counters = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  const client = {
    pipeline() {
      const ops: (() => unknown)[] = [];
      const p = {
        incr(k: string) { ops.push(() => counters.set(k, (counters.get(k) ?? 0) + 1).get(k)); return p; },
        expire() { ops.push(() => 1); return p; },
        pfadd(k: string, v: string) { ops.push(() => { const s = sets.get(k) ?? new Set(); s.add(v); sets.set(k, s); return 1; }); return p; },
        mget(...ks: string[]) { ops.push(() => ks.map((k) => (counters.has(k) ? String(counters.get(k)) : null))); return p; },
        pfcount(...ks: string[]) { ops.push(() => new Set(ks.flatMap((k) => [...(sets.get(k) ?? [])])).size); return p; },
        exec: async () => ops.map((op) => [null, op()] as [null, unknown]),
      };
      return p;
    },
  };
  return { run: async (fn: (c: unknown) => Promise<unknown>) => fn(client) } as unknown as RedisService;
}

describe('VelocityService', () => {
  const base = { projectId: 'p', ipKey: 'ip1', linkedId: null };
  const t0 = Date.UTC(2026, 10, 15, 12, 0, 30);

  it('counts the 5-minute, 1-hour and 24-hour windows separately', async () => {
    const v = new VelocityService(fakeRedis());
    await v.record({ ...base, visitorId: 'a' }, t0 - 30 * 60_000); // 30 min earlier: in 1 h and 24 h, not 5 min
    await v.record({ ...base, visitorId: 'a' }, t0 - 60_000);
    const r = await v.record({ ...base, visitorId: 'a' }, t0);
    expect(r).toMatchObject({ eventsPerVisitor5m: 2, eventsPerVisitor1h: 3, eventsPerVisitor24h: 3 });
  });

  it('counts distinct IPs, countries and accounts per visitor, and visitors per IP and account', async () => {
    const v = new VelocityService(fakeRedis());
    await v.record({ ...base, visitorId: 'a', country: 'DE', linkedId: 'u1' }, t0);
    await v.record({ ...base, visitorId: 'a', ipKey: 'ip2', country: 'NL', linkedId: 'u2' }, t0);
    await v.record({ ...base, visitorId: 'b', linkedId: 'u1' }, t0);
    const r = await v.record({ ...base, visitorId: 'a', ipKey: 'ip3', country: 'US', linkedId: 'u1' }, t0);
    expect(r).toEqual({
      eventsPerVisitor5m: 3,
      eventsPerVisitor1h: 3,
      eventsPerVisitor24h: 3,
      visitorsPerIp1h: 1,
      ipsPerVisitor24h: 3,
      countriesPerVisitor24h: 3,
      linkedIdsPerVisitor24h: 2,
      visitorsPerLinkedId24h: 2,
    });
  });

  it('reports no country count without GeoIP and no account count without a linkedId', async () => {
    const r = await new VelocityService(fakeRedis()).record({ ...base, visitorId: 'a' }, t0);
    expect(r).toMatchObject({ countriesPerVisitor24h: null, visitorsPerLinkedId24h: null, linkedIdsPerVisitor24h: 0 });
  });

  it('returns null when Redis is unavailable', async () => {
    const down = { run: async () => null } as unknown as RedisService;
    expect(await new VelocityService(down).record({ ...base, visitorId: 'a' }, t0)).toBeNull();
  });
});
