import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { RedisService } from './redis.service.js';

const FIXED_WINDOW = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { n, redis.call('PTTL', KEYS[1]) }
`;

export interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Throws 429 with Retry-After when any rule is exceeded; fails open without Redis. */
  async enforce(rules: RateLimitRule[]): Promise<void> {
    if (rules.length === 0) return;
    const results = await this.redis.run(async (client) => {
      const pipeline = client.pipeline();
      for (const rule of rules) pipeline.eval(FIXED_WINDOW, 1, `rl:${rule.key}`, rule.windowMs);
      return pipeline.exec();
    });
    if (!results) return;
    let retryAfterMs = 0;
    results.forEach(([err, value], i) => {
      const rule = rules[i];
      if (err || !rule || !Array.isArray(value)) return;
      const [count, ttl] = value as [number, number];
      if (count > rule.limit) retryAfterMs = Math.max(retryAfterMs, ttl > 0 ? ttl : rule.windowMs);
    });
    if (retryAfterMs > 0) throw ApiError.rateLimited(retryAfterMs / 1000);
  }
}
