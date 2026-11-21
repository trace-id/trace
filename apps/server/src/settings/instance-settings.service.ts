import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { openSecret, sealSecret } from '../webhooks/secret-box.js';

export type SettingKind = 'number' | 'boolean' | 'text' | 'secret';

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  help: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  /** The value used when nothing is saved in the dashboard: what the environment variables say, or a built-in default. */
  fallback: string | number | boolean | null;
  /** Where the fallback comes from, for the dashboard to say so. */
  fallbackSource: 'environment' | 'default';
  /** A change only takes effect after the server restarts. */
  restart?: boolean;
  /** Extra check on a text or secret value; returns a message when it is not acceptable. */
  check?: (value: string) => string | null;
}

/** Everything the dashboard may change, with the environment as the fallback. Add a setting here and it appears there. */
export function settingDefs(env: Env): SettingDef[] {
  return [
    {
      key: 'ip.timeoutMs',
      group: 'ip',
      label: 'Lookup time budget (ms)',
      help: 'All provider calls for one identify share this budget. Past it, a slow provider reads as "not checked" for that event.',
      kind: 'number',
      min: 50,
      max: 5000,
      fallback: env.IP_PROVIDER_TIMEOUT_MS,
      fallbackSource: 'environment',
    },
    {
      key: 'ip.cacheHours',
      group: 'ip',
      label: 'Cache an address for (hours)',
      help: 'A provider is asked about an address once per this time; repeat visitors cost nothing. 0 turns caching off, which uses your quota fast.',
      kind: 'number',
      min: 0,
      max: 720,
      fallback: env.IP_PROVIDER_CACHE_HOURS,
      fallbackSource: 'environment',
    },
    {
      key: 'redis.url',
      group: 'redis',
      label: 'Redis address',
      help: 'Rate limits, velocity signals and the shared IP cache use it. Saved encrypted. Without one, they fall back to memory or are off.',
      kind: 'secret',
      fallback: env.REDIS_URL ?? null,
      fallbackSource: 'environment',
      check: (v) => (/^rediss?:\/\/\S+$/i.test(v) ? null : 'The address must start with redis:// or rediss://'),
    },
    {
      key: 'ip.sharedCache',
      group: 'ip',
      label: 'Share the cache through Redis',
      help: 'Keeps answers across restarts and between server instances. Needs Redis; without it, the cache lives in memory only.',
      kind: 'boolean',
      fallback: true,
      fallbackSource: 'default',
    },
  ];
}

export interface SettingView {
  key: string;
  group: string;
  label: string;
  help: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  /** Secrets are never returned: only whether one is set. */
  value: string | number | boolean | null;
  isSet: boolean;
  source: 'dashboard' | 'environment' | 'default';
  fallback: string | number | boolean | null;
  restart: boolean;
}

@Injectable()
export class InstanceSettingsService implements OnModuleInit {
  private readonly logger = new Logger('InstanceSettings');
  private readonly stored = new Map<string, string>();
  private readonly listeners = new Set<(keys: string[]) => void | Promise<void>>();
  private readonly defs: SettingDef[];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.defs = settingDefs(env);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.load();
    } catch (err) {
      this.logger.warn(`could not load saved settings, using the environment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async load(): Promise<void> {
    const rows = await this.prisma.instanceSetting.findMany();
    this.stored.clear();
    for (const r of rows) this.stored.set(r.key, r.value);
  }

  /** Called after any change, with the keys that changed. The change is only reported done once listeners finish. */
  onChange(listener: (keys: string[]) => void | Promise<void>): void {
    this.listeners.add(listener);
  }

  private def(key: string): SettingDef {
    const d = this.defs.find((x) => x.key === key);
    if (!d) throw ApiError.badRequest(`Unknown setting: ${key}`, 'unknown_setting');
    return d;
  }

  private parse(d: SettingDef, raw: string): string | number | boolean {
    if (d.kind === 'number') return Number(raw);
    if (d.kind === 'boolean') return raw === 'true';
    if (d.kind === 'secret') return openSecret(raw, this.env.TOKEN_SECRET);
    return raw;
  }

  /** The effective value: saved in the dashboard, else the environment or built-in fallback. */
  get<T extends string | number | boolean | null = string | number | boolean | null>(key: string): T {
    const d = this.def(key);
    const raw = this.stored.get(key);
    if (raw === undefined) return d.fallback as T;
    try {
      return this.parse(d, raw) as T;
    } catch {
      // A secret that cannot be opened (TOKEN_SECRET changed) reads as unset.
      return d.fallback as T;
    }
  }

  list(): SettingView[] {
    return this.defs.map((d) => {
      const isSet = this.stored.has(d.key);
      const value = this.get(d.key);
      return {
        key: d.key,
        group: d.group,
        label: d.label,
        help: d.help,
        kind: d.kind,
        ...(d.min !== undefined ? { min: d.min } : {}),
        ...(d.max !== undefined ? { max: d.max } : {}),
        value: d.kind === 'secret' ? null : value,
        isSet: d.kind === 'secret' ? isSet || d.fallback !== null : isSet,
        source: isSet ? 'dashboard' : d.fallback === null ? 'default' : d.fallbackSource,
        fallback: d.kind === 'secret' ? null : d.fallback,
        restart: d.restart ?? false,
      };
    });
  }

  private validate(d: SettingDef, value: unknown): string {
    if (d.kind === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) {
        throw ApiError.badRequest(`${d.label} must be a number from ${d.min ?? '-∞'} to ${d.max ?? '∞'}`, 'invalid_setting');
      }
      return String(n);
    }
    if (d.kind === 'boolean') {
      if (typeof value !== 'boolean') throw ApiError.badRequest(`${d.label} must be true or false`, 'invalid_setting');
      return String(value);
    }
    if (typeof value !== 'string' || value.trim() === '' || value.length > 2000) throw ApiError.badRequest(`${d.label} must be a non-empty text`, 'invalid_setting');
    const text = value.trim();
    const problem = d.check?.(text);
    if (problem) throw ApiError.badRequest(problem, 'invalid_setting');
    return d.kind === 'secret' ? sealSecret(text, this.env.TOKEN_SECRET) : text;
  }

  /** Saves values (or clears them with null, returning to the fallback). All or nothing. */
  async update(changes: Record<string, unknown>, userId: string): Promise<string[]> {
    const writes: { key: string; value: string | null }[] = [];
    for (const [key, value] of Object.entries(changes)) {
      const d = this.def(key);
      writes.push({ key, value: value === null ? null : this.validate(d, value) });
    }
    await this.prisma.$transaction(
      writes.map((w) =>
        w.value === null
          ? this.prisma.instanceSetting.deleteMany({ where: { key: w.key } })
          : this.prisma.instanceSetting.upsert({
              where: { key: w.key },
              create: { key: w.key, value: w.value, updatedBy: userId.slice(0, 64) },
              update: { value: w.value, updatedBy: userId.slice(0, 64) },
            }),
      ),
    );
    for (const w of writes) {
      if (w.value === null) this.stored.delete(w.key);
      else this.stored.set(w.key, w.value);
    }
    const keys = writes.map((w) => w.key);
    for (const l of this.listeners) {
      try {
        await l(keys);
      } catch (err) {
        this.logger.warn(`a settings listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return keys;
  }
}
