import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';

const WARN_INTERVAL_MS = 60_000;

/**
 * Redis is an accelerator, not a dependency: when it is missing or failing, callers get
 * null and carry on (fail open), and we log at most once a minute so outages are visible.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  private readonly client: Redis | null;
  private lastWarn = 0;

  constructor(@Inject(ENV) env: Env) {
    if (!env.REDIS_URL) {
      this.logger.warn('REDIS_URL not set: rate limits and velocity signals are disabled');
      this.client = null;
      return;
    }
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 150,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (err: Error) => this.warn(`connection error: ${err.message}`));
  }

  get available(): boolean {
    return this.client?.status === 'ready';
  }

  async run<T>(op: (client: Redis) => Promise<T>): Promise<T | null> {
    if (!this.client || this.client.status !== 'ready') return null;
    try {
      return await op(this.client);
    } catch (err) {
      this.warn(`command failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  }

  private warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarn < WARN_INTERVAL_MS) return;
    this.lastWarn = now;
    this.logger.warn(`${message} (failing open)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    await this.client.quit().catch(() => this.client?.disconnect());
  }
}
