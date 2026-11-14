import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type VelocityCounts } from '@tbdname/signals/types';
import { RedisService } from '../infra/redis.service.js';

const SHORT_BUCKET_MS = 10 * 60_000;
const SHORT_BUCKETS = 6;
const LONG_BUCKET_MS = 60 * 60_000;
const LONG_BUCKETS = 24;

export interface VelocityInput {
  projectId: string;
  visitorId: string;
  ipKey: string;
  linkedId: string | null;
}

function short(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}

function bucketKeys(base: string, now: number, bucketMs: number, count: number): string[] {
  const current = Math.floor(now / bucketMs);
  return Array.from({ length: count }, (_, i) => `${base}:${current - i}`);
}

/**
 * Sliding windows approximated by summing fixed buckets (10 min for 1 h, 1 h for 24 h).
 * Distinct counts use HyperLogLog (about 1% error, constant memory per key).
 * Returns null when Redis is unavailable, so the velocity signal reports "not available".
 */
@Injectable()
export class VelocityService {
  constructor(private readonly redis: RedisService) {}

  async record(input: VelocityInput, now: number = Date.now()): Promise<VelocityCounts | null> {
    const p = input.projectId;
    const ev = bucketKeys(`vel:${p}:ev:${input.visitorId}`, now, SHORT_BUCKET_MS, SHORT_BUCKETS);
    const vip = bucketKeys(`vel:${p}:vip:${input.ipKey}`, now, SHORT_BUCKET_MS, SHORT_BUCKETS);
    const ipv = bucketKeys(`vel:${p}:ipv:${input.visitorId}`, now, LONG_BUCKET_MS, LONG_BUCKETS);
    const link = input.linkedId
      ? bucketKeys(`vel:${p}:lnk:${short(input.linkedId)}`, now, LONG_BUCKET_MS, LONG_BUCKETS)
      : null;
    const shortTtl = Math.ceil((SHORT_BUCKET_MS * (SHORT_BUCKETS + 1)) / 1000);
    const longTtl = Math.ceil((LONG_BUCKET_MS * (LONG_BUCKETS + 1)) / 1000);

    const results = await this.redis.run(async (client) => {
      const pipe = client.pipeline();
      pipe.incr(ev[0] as string).expire(ev[0] as string, shortTtl);
      pipe.pfadd(vip[0] as string, input.visitorId).expire(vip[0] as string, shortTtl);
      pipe.pfadd(ipv[0] as string, input.ipKey).expire(ipv[0] as string, longTtl);
      if (link) pipe.pfadd(link[0] as string, input.visitorId).expire(link[0] as string, longTtl);
      pipe.mget(...ev);
      pipe.pfcount(...vip);
      pipe.pfcount(...ipv);
      if (link) pipe.pfcount(...link);
      return pipe.exec();
    });
    if (!results || results.some(([err]) => err)) return null;

    const reads = results.slice(link ? 8 : 6).map(([, value]) => value);
    const events = (reads[0] as (string | null)[]).reduce((sum, v) => sum + (v ? Number(v) : 0), 0);
    return {
      eventsPerVisitor1h: events,
      visitorsPerIp1h: Number(reads[1]),
      ipsPerVisitor24h: Number(reads[2]),
      visitorsPerLinkedId24h: link ? Number(reads[3]) : null,
    };
  }
}
