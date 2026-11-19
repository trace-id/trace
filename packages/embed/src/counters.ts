import { createHash } from 'node:crypto';
import { type VelocityCounts } from '@trace-id/signals/types';

export interface CounterInput {
  visitorId: string;
  ipKey: string;
  linkedId: string | null;
  country?: string | null;
}

/**
 * Sliding-window counters for the velocity and highActivity signals. Return null when unavailable: those signals then
 * report "not available" instead of guessing.
 */
export interface TraceCounters {
  record(input: CounterInput, now?: number): Promise<VelocityCounts | null>;
  /**
   * Optional: remembers a request nonce for `ttlMs`. Resolves true the first time, false when it was already seen, and
   * null when the store is unavailable (replay detection then reports "not available").
   */
  claimNonce?(nonce: string, ttlMs: number, now?: number): Promise<boolean | null>;
}

const MIN = 60_000;
const WINDOWS = { m5: 5 * MIN, h1: 60 * MIN, h24: 24 * 60 * MIN };

/**
 * In-process counters. Right for one server process (and for tests); with several instances each one only sees its own
 * traffic, so use redisCounters there. Memory is bounded: entries older than 24 h are dropped as they are touched.
 */
export function memoryCounters(): TraceCounters {
  const events = new Map<string, number[]>();
  const sets = new Map<string, Map<string, number>>();
  const prune = (list: number[], now: number) => {
    const cut = now - WINDOWS.h24;
    let i = 0;
    while (i < list.length && list[i]! < cut) i++;
    if (i > 0) list.splice(0, i);
  };
  const hit = (key: string, now: number) => {
    const list = events.get(key) ?? [];
    prune(list, now);
    list.push(now);
    events.set(key, list);
    return list;
  };
  const countSince = (list: number[], since: number) => list.reduce((n, t) => n + (t >= since ? 1 : 0), 0);
  const add = (key: string, member: string, now: number, window: number) => {
    const set = sets.get(key) ?? new Map<string, number>();
    set.set(member, now);
    for (const [m, t] of set) if (t < now - window) set.delete(m);
    sets.set(key, set);
    return set.size;
  };
  const nonces = new Map<string, number>(); // nonce -> expires at
  return {
    async claimNonce(nonce, ttlMs, now = Date.now()) {
      if (nonces.size > 10_000) for (const [n, until] of nonces) if (until <= now) nonces.delete(n);
      const until = nonces.get(nonce);
      if (until !== undefined && until > now) return false;
      nonces.set(nonce, now + ttlMs);
      return true;
    },
    async record(input, now = Date.now()) {
      const v = hit(`ev:${input.visitorId}`, now);
      return {
        eventsPerVisitor5m: countSince(v, now - WINDOWS.m5),
        eventsPerVisitor1h: countSince(v, now - WINDOWS.h1),
        eventsPerVisitor24h: v.length,
        visitorsPerIp1h: add(`vip:${input.ipKey}`, input.visitorId, now, WINDOWS.h1),
        ipsPerVisitor24h: add(`ipv:${input.visitorId}`, input.ipKey, now, WINDOWS.h24),
        countriesPerVisitor24h: input.country ? add(`cty:${input.visitorId}`, input.country, now, WINDOWS.h24) : null,
        linkedIdsPerVisitor24h: input.linkedId ? add(`lid:${input.visitorId}`, input.linkedId, now, WINDOWS.h24) : (sets.get(`lid:${input.visitorId}`)?.size ?? 0),
        visitorsPerLinkedId24h: input.linkedId ? add(`lnk:${input.linkedId}`, input.visitorId, now, WINDOWS.h24) : null,
      };
    },
  };
}

/** The subset of an ioredis client this needs. node-redis users can wrap theirs to match. */
export interface RedisPipelineClient {
  pipeline(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number): unknown;
    pfadd(key: string, ...members: string[]): unknown;
    mget(...keys: string[]): unknown;
    pfcount(...keys: string[]): unknown;
    /** ioredis set; used with NX and PX for request nonces. */
    set?(key: string, value: string, ...args: (string | number)[]): unknown;
    exec(): Promise<[Error | null, unknown][] | null>;
  };
}

const MINUTE_BUCKET_MS = 60_000;
const SHORT_BUCKET_MS = 10 * 60_000;
const LONG_BUCKET_MS = 60 * 60_000;

function short(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}
function bucketKeys(base: string, now: number, bucketMs: number, count: number): string[] {
  const current = Math.floor(now / bucketMs);
  return Array.from({ length: count }, (_, i) => `${base}:${current - i}`);
}
const ttl = (bucketMs: number, count: number) => Math.ceil((bucketMs * (count + 1)) / 1000);

/**
 * Shared counters on a Redis you already run, so several app instances count together. Keys are prefixed (default
 * "trace:vel") so they never collide with your own. Buckets: 1 min for 5 min, 10 min for 1 h, 1 h for 24 h; distinct
 * counts use HyperLogLog (about 1% error, constant memory).
 */
export function redisCounters(client: RedisPipelineClient, prefix = 'trace:vel'): TraceCounters {
  return {
    async claimNonce(nonce, ttlMs) {
      const pipe = client.pipeline();
      if (!pipe.set) return null;
      try {
        pipe.set(`${prefix}:nonce:${nonce}`, '1', 'PX', ttlMs, 'NX');
        const res = await pipe.exec();
        const [err, value] = res?.[0] ?? [new Error('no reply'), null];
        if (err) return null;
        return value === 'OK';
      } catch {
        return null;
      }
    },
    async record(input, now = Date.now()) {
      const v = input.visitorId;
      const keys = {
        ev5: bucketKeys(`${prefix}:ev5:${v}`, now, MINUTE_BUCKET_MS, 5),
        ev: bucketKeys(`${prefix}:ev:${v}`, now, SHORT_BUCKET_MS, 6),
        vip: bucketKeys(`${prefix}:vip:${input.ipKey}`, now, SHORT_BUCKET_MS, 6),
        ev24: bucketKeys(`${prefix}:ev24:${v}`, now, LONG_BUCKET_MS, 24),
        ipv: bucketKeys(`${prefix}:ipv:${v}`, now, LONG_BUCKET_MS, 24),
        cty: bucketKeys(`${prefix}:cty:${v}`, now, LONG_BUCKET_MS, 24),
        lid: bucketKeys(`${prefix}:lid:${v}`, now, LONG_BUCKET_MS, 24),
        lnk: input.linkedId ? bucketKeys(`${prefix}:lnk:${short(input.linkedId)}`, now, LONG_BUCKET_MS, 24) : null,
      };
      const t5 = ttl(MINUTE_BUCKET_MS, 5);
      const t1 = ttl(SHORT_BUCKET_MS, 6);
      const t24 = ttl(LONG_BUCKET_MS, 24);
      try {
        const pipe = client.pipeline();
        pipe.incr(keys.ev5[0]!); pipe.expire(keys.ev5[0]!, t5);
        pipe.incr(keys.ev[0]!); pipe.expire(keys.ev[0]!, t1);
        pipe.incr(keys.ev24[0]!); pipe.expire(keys.ev24[0]!, t24);
        pipe.pfadd(keys.vip[0]!, v); pipe.expire(keys.vip[0]!, t1);
        pipe.pfadd(keys.ipv[0]!, input.ipKey); pipe.expire(keys.ipv[0]!, t24);
        if (input.country) { pipe.pfadd(keys.cty[0]!, input.country); pipe.expire(keys.cty[0]!, t24); }
        if (input.linkedId) { pipe.pfadd(keys.lid[0]!, short(input.linkedId)); pipe.expire(keys.lid[0]!, t24); }
        if (keys.lnk) { pipe.pfadd(keys.lnk[0]!, v); pipe.expire(keys.lnk[0]!, t24); }
        const reads = ['ev5', 'ev', 'ev24', 'vip', 'ipv', 'cty', 'lid', ...(keys.lnk ? ['lnk'] : [])];
        pipe.mget(...keys.ev5); pipe.mget(...keys.ev); pipe.mget(...keys.ev24);
        pipe.pfcount(...keys.vip); pipe.pfcount(...keys.ipv); pipe.pfcount(...keys.cty); pipe.pfcount(...keys.lid);
        if (keys.lnk) pipe.pfcount(...keys.lnk);
        const results = await pipe.exec();
        if (!results || results.some(([err]) => err)) return null;
        const tail = results.slice(results.length - reads.length).map(([, value]) => value);
        const value = (name: string): unknown => tail[reads.indexOf(name)];
        const sum = (values: unknown) => (values as (string | null)[]).reduce((t, x) => t + (x ? Number(x) : 0), 0);
        return {
          eventsPerVisitor5m: sum(value('ev5')),
          eventsPerVisitor1h: sum(value('ev')),
          eventsPerVisitor24h: sum(value('ev24')),
          visitorsPerIp1h: Number(value('vip')),
          ipsPerVisitor24h: Number(value('ipv')),
          countriesPerVisitor24h: input.country ? Number(value('cty')) : null,
          linkedIdsPerVisitor24h: Number(value('lid')),
          visitorsPerLinkedId24h: keys.lnk ? Number(value('lnk')) : null,
        };
      } catch {
        return null;
      }
    },
  };
}
