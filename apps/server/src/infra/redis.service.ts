import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { InstanceSettingsService } from '../settings/instance-settings.service.js';

const WARN_INTERVAL_MS = 60_000;

/** Never includes the password or the user name: just where the server is connecting to. */
export function redisTarget(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol === 'rediss:' ? 'rediss://' : ''}${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return null;
  }
}

export interface RedisProbeResult {
  ok: boolean;
  latencyMs: number;
  /** A short reason, never containing the URL. */
  error?: string;
}

/** Connects once, pings and disconnects. For the dashboard's "test connection" button. */
export async function probeRedis(url: string, timeoutMs = 3000): Promise<RedisProbeResult> {
  const started = Date.now();
  const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: timeoutMs, commandTimeout: timeoutMs, retryStrategy: () => null });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === 'PONG' ? { ok: true, latencyMs: Date.now() - started } : { ok: false, latencyMs: Date.now() - started, error: 'Unexpected answer to PING' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not connect';
    // ioredis messages do not include the URL, but strip anything shaped like one to be sure.
    return { ok: false, latencyMs: Date.now() - started, error: message.replace(/rediss?:\/\/\S+/gi, '(url)').slice(0, 200) };
  } finally {
    client.disconnect();
  }
}

/**
 * Redis is an accelerator, not a dependency: when it is missing or failing, callers get
 * null and carry on (fail open), and we log at most once a minute so outages are visible.
 * The address can come from REDIS_URL or from the dashboard (which wins) and can change without a restart.
 */
@Injectable()
export class RedisService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  private client: Redis | null = null;
  private url: string | null = null;
  private lastWarn = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: InstanceSettingsService,
  ) {
    this.connect(env.REDIS_URL ?? null);
  }

  private connect(url: string | null): void {
    this.url = url;
    if (!url) {
      this.logger.warn('No Redis address set: rate limits, velocity signals and the shared IP cache are disabled');
      this.client = null;
      return;
    }
    const client = new Redis(url, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 150,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    client.on('error', (err: Error) => this.warn(`connection error: ${err.message}`));
    this.client = client;
  }

  /** Once all modules are up the saved settings are loaded: switch to the dashboard's address if there is one. */
  async onApplicationBootstrap(): Promise<void> {
    this.settings.onChange(async (keys) => {
      if (keys.includes('redis.url')) await this.apply();
    });
    await this.apply();
  }

  private async apply(): Promise<void> {
    await this.reconfigure(this.settings.get<string | null>('redis.url'));
  }

  /** Moves to a new address (or none) and closes the old connection. Does nothing when the address is unchanged. */
  async reconfigure(url: string | null): Promise<void> {
    if (url === this.url) return;
    const old = this.client;
    this.connect(url);
    this.logger.log(url ? `now using Redis at ${redisTarget(url)}` : 'Redis turned off');
    if (old) await old.quit().catch(() => old.disconnect());
  }

  /** Where it is connected, without credentials. */
  get target(): string | null {
    return redisTarget(this.url);
  }

  get available(): boolean {
    return this.client?.status === 'ready';
  }

  /** The state of the connection, for the dashboard. */
  get status(): 'off' | 'connected' | 'connecting' | 'failing' {
    if (!this.client) return 'off';
    if (this.client.status === 'ready') return 'connected';
    return this.client.status === 'connecting' || this.client.status === 'connect' ? 'connecting' : 'failing';
  }

  async run<T>(op: (client: Redis) => Promise<T>): Promise<T | null> {
    const client = this.client;
    if (!client || client.status !== 'ready') return null;
    try {
      return await op(client);
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
    const client = this.client;
    if (!client) return;
    await client.quit().catch(() => client.disconnect());
  }
}
