import { createHmac } from 'node:crypto';
import { type IpCacheStore, type IpFacts } from '@trace-id/ip-intel';
import { type RedisService } from '../infra/redis.service.js';

const PREFIX = 'trace:ipintel:v1:';

/**
 * Shares provider answers between server instances and across restarts, so an address costs one provider call per
 * TTL however many processes see it. Redis never sees a raw IP: the cache key is a keyed hash of the source and the
 * address. A Redis outage reads as a miss (RedisService fails open).
 */
export class RedisIpCache implements IpCacheStore {
  constructor(
    private readonly redis: RedisService,
    private readonly secret: string,
    private readonly enabled: () => boolean,
  ) {}

  private key(raw: string): string {
    return PREFIX + createHmac('sha256', this.secret).update('ip-cache-v1\0').update(raw).digest('hex').slice(0, 40);
  }

  async get(key: string): Promise<IpFacts | null> {
    if (!this.enabled()) return null;
    const value = await this.redis.run((c) => c.get(this.key(key)));
    if (!value) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? (parsed as IpFacts) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, facts: IpFacts, ttlMs: number): Promise<void> {
    if (!this.enabled()) return;
    await this.redis.run((c) => c.set(this.key(key), JSON.stringify(facts), 'PX', Math.max(1000, Math.round(ttlMs))));
  }
}
