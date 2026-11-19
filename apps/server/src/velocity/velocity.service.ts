import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type VelocityCounts } from '@trace-id/signals/types';
import { RedisService } from '../infra/redis.service.js';

const MINUTE_BUCKET_MS = 60_000;
const MINUTE_BUCKETS = 5;
const SHORT_BUCKET_MS = 10 * 60_000;
const SHORT_BUCKETS = 6;
const LONG_BUCKET_MS = 60 * 60_000;
const LONG_BUCKETS = 24;

export interface VelocityInput {
  projectId: string;
  visitorId: string;
  ipKey: string;
  linkedId: string | null;
  /** IP country, when GeoIP is configured. */
  country?: string | null;
}

function short(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}

function bucketKeys(base: string, now: number, bucketMs: number, count: number): string[] {
  const current = Math.floor(now / bucketMs);
  return Array.from({ length: count }, (_, i) => `${base}:${current - i}`);
}

const ttl = (bucketMs: number, count: number) => Math.ceil((bucketMs * (count + 1)) / 1000);

/**
 * Sliding windows approximated by summing fixed buckets (1 min for 5 min, 10 min for 1 h, 1 h for 24 h).
 * Distinct counts use HyperLogLog (about 1% error, constant memory per key).
 * Returns null when Redis is unavailable, so the velocity signal reports "not available".
 */
@Injectable()
export class VelocityService {
  constructor(private readonly redis: RedisService) {}

  async record(input: VelocityInput, now: number = Date.now()): Promise<VelocityCounts | null> {
    const p = input.projectId;
    const v = input.visitorId;
    const keys = {
      ev5: bucketKeys(`vel:${p}:ev5:${v}`, now, MINUTE_BUCKET_MS, MINUTE_BUCKETS),
      ev: bucketKeys(`vel:${p}:ev:${v}`, now, SHORT_BUCKET_MS, SHORT_BUCKETS),
      vip: bucketKeys(`vel:${p}:vip:${input.ipKey}`, now, SHORT_BUCKET_MS, SHORT_BUCKETS),
      ev24: bucketKeys(`vel:${p}:ev24:${v}`, now, LONG_BUCKET_MS, LONG_BUCKETS),
      ipv: bucketKeys(`vel:${p}:ipv:${v}`, now, LONG_BUCKET_MS, LONG_BUCKETS),
      cty: bucketKeys(`vel:${p}:cty:${v}`, now, LONG_BUCKET_MS, LONG_BUCKETS),
      lid: bucketKeys(`vel:${p}:lid:${v}`, now, LONG_BUCKET_MS, LONG_BUCKETS),
      lnk: input.linkedId ? bucketKeys(`vel:${p}:lnk:${short(input.linkedId)}`, now, LONG_BUCKET_MS, LONG_BUCKETS) : null,
    };
    const minuteTtl = ttl(MINUTE_BUCKET_MS, MINUTE_BUCKETS);
    const shortTtl = ttl(SHORT_BUCKET_MS, SHORT_BUCKETS);
    const longTtl = ttl(LONG_BUCKET_MS, LONG_BUCKETS);

    // Reads are named so their reply positions never have to be counted by hand.
    const reads: string[] = [];
    const results = await this.redis.run(async (client) => {
      const pipe = client.pipeline();
      pipe.incr(keys.ev5[0]!).expire(keys.ev5[0]!, minuteTtl);
      pipe.incr(keys.ev[0]!).expire(keys.ev[0]!, shortTtl);
      pipe.incr(keys.ev24[0]!).expire(keys.ev24[0]!, longTtl);
      pipe.pfadd(keys.vip[0]!, v).expire(keys.vip[0]!, shortTtl);
      pipe.pfadd(keys.ipv[0]!, input.ipKey).expire(keys.ipv[0]!, longTtl);
      if (input.country) pipe.pfadd(keys.cty[0]!, input.country).expire(keys.cty[0]!, longTtl);
      if (input.linkedId) pipe.pfadd(keys.lid[0]!, short(input.linkedId)).expire(keys.lid[0]!, longTtl);
      if (keys.lnk) pipe.pfadd(keys.lnk[0]!, v).expire(keys.lnk[0]!, longTtl);
      const read = (name: string, add: () => void) => {
        reads.push(name);
        add();
      };
      read('ev5', () => pipe.mget(...keys.ev5));
      read('ev', () => pipe.mget(...keys.ev));
      read('ev24', () => pipe.mget(...keys.ev24));
      read('vip', () => pipe.pfcount(...keys.vip));
      read('ipv', () => pipe.pfcount(...keys.ipv));
      read('cty', () => pipe.pfcount(...keys.cty));
      read('lid', () => pipe.pfcount(...keys.lid));
      if (keys.lnk) read('lnk', () => pipe.pfcount(...keys.lnk!));
      return pipe.exec();
    });
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
  }
}
