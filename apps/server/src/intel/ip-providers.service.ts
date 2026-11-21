import { isIP } from 'node:net';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type IpFacts,
  type IpIntelSource,
  type IpIntelStats,
  type KeyState,
  type PooledSource,
  descriptor,
  isPublicIp,
  needsKey,
  pooledSource,
  type ProviderDescriptor,
  REGISTRY,
  validateValues,
} from '@trace-id/ip-intel';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { InstanceSettingsService, type SettingView } from '../settings/instance-settings.service.js';
import { openSecret, sealSecret } from '../webhooks/secret-box.js';
import { type FileIntelSource, ReloadableIpIntel } from './build.js';
import { IP_INTEL, type IpIntelProvider } from './ip-intel.js';
import { RedisIpCache } from './redis-ip-cache.js';
import { UsageBuffer, type UsageRow } from './usage-hub.js';

const MAX_PROVIDERS = 30;
const MAX_KEYS_PER_PROVIDER = 50;
const FLUSH_MS = 15_000;
const USAGE_KEEP_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const valuesSchema = z.record(z.string().max(64), z.union([z.string().max(512), z.boolean(), z.number()]));
const limit = z.number().int().min(1).max(100_000_000).nullable();

const providerFields = {
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(10_000),
  sharePercent: z.number().int().min(0).max(100),
  dailyLimit: limit,
  strategy: z.enum(['weighted', 'failover']),
  settings: valuesSchema,
};
const keyFields = {
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  weight: z.number().int().min(1).max(1000),
  dailyLimit: limit,
};
const newKey = z.object({ ...keyFields, values: valuesSchema }).partial({ label: true, enabled: true, weight: true, dailyLimit: true }).strict();
const createProviderSchema = z
  .object({ provider: z.string().max(40), ...providerFields, key: newKey })
  .partial({ label: true, enabled: true, priority: true, sharePercent: true, dailyLimit: true, strategy: true, settings: true, key: true })
  .strict();
const updateProviderSchema = z.object(providerFields).partial().strict();
const updateKeySchema = z.object({ ...keyFields, values: valuesSchema }).partial().strict();
const testSchema = z
  .object({
    ip: z.string().max(64),
    providerId: z.string().optional(),
    keyId: z.string().optional(),
    provider: z.string().max(40).optional(),
    settings: valuesSchema.optional(),
    values: valuesSchema.optional(),
  })
  .strict();

const invalid = (error: z.ZodError): ApiError => ApiError.badRequest(`Invalid fields: ${[...new Set(error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ')}`);

export interface KeyView {
  id: string;
  label: string;
  /** A masked preview such as ••••a1b2. The key itself is never returned. */
  hint: string;
  enabled: boolean;
  weight: number;
  dailyLimit: number | null;
  usedToday: number;
  coolingUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  broken: string | null;
  createdAt: string;
}

export type ProviderStatus = 'ok' | 'degraded' | 'down' | 'disabled';

export interface ProviderView {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  priority: number;
  sharePercent: number;
  dailyLimit: number | null;
  strategy: 'weighted' | 'failover';
  settings: Record<string, string>;
  keys: KeyView[];
  usedToday: number;
  status: ProviderStatus;
  /** Why the status is not ok, in a sentence. */
  statusDetail: string | null;
  createdAt: string;
}

export interface UsageTotals {
  requests: number;
  ok: number;
  errors: number;
  rateLimited: number;
  authFailed: number;
  skipped: number;
  avgLatencyMs: number | null;
}

export interface IpOverview {
  registry: ProviderInfo[];
  providers: ProviderView[];
  /** Providers named in IP_PROVIDERS: read-only here, but counted like the others. */
  environment: { ref: string; provider: string; usage: UsageTotals }[];
  cache: { redis: boolean; sharedEnabled: boolean; ttlHours: number; timeoutMs: number } & IpIntelStats;
  /** Sizes of the local lists and databases, when the server has any. */
  files: FileIntelSource['sizes'] | null;
  settings: SettingView[];
  totalsToday: UsageTotals;
  canReload: boolean;
}

/** A registry entry without its code: what the dashboard needs to draw the form. */
export type ProviderInfo = Omit<ProviderDescriptor, 'build' | 'check'>;

const info = ({ build: _build, check: _check, ...rest }: ProviderDescriptor): ProviderInfo => rest;

export interface UsagePoint extends UsageTotals {
  day: string;
  providerRef: string;
  keyRef: string;
  provider: string;
}

const emptyTotals = (): UsageTotals => ({ requests: 0, ok: 0, errors: 0, rateLimited: 0, authFailed: 0, skipped: 0, avgLatencyMs: null });

function addRow(t: UsageTotals & { latencySum?: number }, r: UsageRow): void {
  t.requests += r.requests;
  t.ok += r.ok;
  t.errors += r.errors;
  t.rateLimited += r.rateLimited;
  t.authFailed += r.authFailed;
  t.skipped += r.skipped;
  t.latencySum = (t.latencySum ?? 0) + r.latencyMs;
}

function finish(t: UsageTotals & { latencySum?: number }): UsageTotals {
  const { latencySum, ...rest } = t;
  return { ...rest, avgLatencyMs: rest.requests > 0 ? Math.round((latencySum ?? 0) / rest.requests) : null };
}

/** The first account on the server administers it: providers, keys and instance settings are instance-wide. */
export async function isInstanceAdmin(prisma: PrismaService, userId: string): Promise<boolean> {
  const first = await prisma.user.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  return first?.id === userId;
}

/** "••••a1b2" for a secret long enough to show a tail safely, "••••" otherwise. */
export function maskHint(secret: string | undefined): string {
  if (!secret) return '(no key)';
  return secret.length >= 12 ? `••••${secret.slice(-4)}` : '••••';
}

const mask = (message: string, secrets: string[]): string => secrets.reduce((m, s) => (s.length >= 4 ? m.split(s).join('•••') : m), message);

@Injectable()
export class IpProvidersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IpProviders');
  private readonly reloadable: ReloadableIpIntel | null;
  private readonly pools = new Map<string, PooledSource>();
  private readonly refProvider = new Map<string, string>();
  private readonly buffer: UsageBuffer;
  private readonly sharedCache: RedisIpCache;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(IP_INTEL) intel: IpIntelProvider,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: InstanceSettingsService,
  ) {
    this.reloadable = intel instanceof ReloadableIpIntel ? intel : null;
    this.buffer = new UsageBuffer((ref) => this.refProvider.get(ref) ?? (ref.startsWith('env:') ? ref.slice(4) : 'unknown'));
    this.sharedCache = new RedisIpCache(redis, env.TOKEN_SECRET, () => this.settings.get<boolean>('ip.sharedCache'));
    for (const s of this.reloadable?.envSources ?? []) this.refProvider.set(s.ref ?? `env:${s.name}`, s.name);
  }

  async onModuleInit(): Promise<void> {
    this.reloadable?.hub.subscribe((e) => this.buffer.add(e));
    this.settings.onChange(async (keys) => {
      if (keys.some((k) => k.startsWith('ip.'))) await this.reload();
    });
    try {
      await this.reload();
    } catch (err) {
      this.logger.warn(`could not load providers from the database, using the environment only: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  // ---------- runtime

  private keyValues(sealed: string, id: string): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(openSecret(sealed, this.env.TOKEN_SECRET));
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch {
      this.logger.warn(`key ${id} cannot be decrypted (was TOKEN_SECRET changed?); it is skipped`);
      return {};
    }
  }

  private reloading: Promise<void> = Promise.resolve();

  /** Rebuilds the lookup chain from the database and the current settings. Calls queue, so the last one wins. */
  reload(): Promise<void> {
    const run = this.reloading.then(() => this.rebuild());
    this.reloading = run.catch(() => {});
    return run;
  }

  private async rebuild(): Promise<void> {
    if (!this.reloadable) return;
    const rows = await this.prisma.ipProvider.findMany({
      where: { enabled: true },
      include: { keys: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const used = await this.usedToday();
    const sources: IpIntelSource[] = [];
    this.pools.clear();
    for (const row of rows) {
      const d = descriptor(row.provider);
      if (!d) {
        this.logger.warn(`provider ${row.id} names "${row.provider}", which this version does not know; skipped`);
        continue;
      }
      this.refProvider.set(row.id, d.id);
      const settings = this.stringValues(row.settings);
      if (!d.remote) {
        try {
          sources.push({ ...d.build(settings, {}), ref: row.id });
        } catch (err) {
          this.logger.warn(`provider ${row.id} (${d.id}) is misconfigured: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }
      const pool = pooledSource({
        ref: row.id,
        descriptor: d,
        settings,
        strategy: row.strategy === 'failover' ? 'failover' : 'weighted',
        sharePercent: row.sharePercent,
        dailyLimit: row.dailyLimit,
        initialUsed: used,
        onUsage: this.reloadable.hub.emit,
        keys: row.keys.map((k) => ({
          id: k.id,
          label: k.label,
          values: this.keyValues(k.sealed, k.id),
          weight: k.weight,
          dailyLimit: k.dailyLimit,
          enabled: k.enabled,
        })),
      });
      this.pools.set(row.id, pool);
      sources.push(pool);
    }
    this.reloadable.configure(sources, {
      timeoutMs: this.settings.get<number>('ip.timeoutMs'),
      cacheTtlMs: this.settings.get<number>('ip.cacheHours') * 3_600_000,
      sharedCache: this.settings.get<boolean>('ip.sharedCache') ? this.sharedCache : undefined,
    });
  }

  private stringValues(input: unknown): Record<string, string> {
    if (typeof input !== 'object' || input === null) return {};
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]));
  }

  // ---------- usage

  /** Calls made today per key id, stored plus not yet written. */
  private async usedToday(): Promise<Record<string, number>> {
    const day = new Date().toISOString().slice(0, 10);
    const out: Record<string, number> = {};
    try {
      const rows = await this.prisma.ipProviderUsage.findMany({ where: { day: new Date(`${day}T00:00:00Z`) } });
      for (const r of rows) if (r.keyRef) out[r.keyRef] = (out[r.keyRef] ?? 0) + r.requests;
    } catch {
      // Counters restart from zero if the table cannot be read.
    }
    for (const r of this.buffer.pending()) if (r.day === day && r.keyRef) out[r.keyRef] = (out[r.keyRef] ?? 0) + r.requests;
    return out;
  }

  /** Writes counted usage to the database. A failed write is kept and retried. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const rows = this.buffer.drain();
    if (rows.length === 0) return Promise.resolve();
    this.flushing = (async () => {
      try {
        for (const r of rows) {
          await this.prisma.$executeRaw`
            INSERT INTO ip_provider_usage ("day", "providerRef", "keyRef", "provider", "requests", "ok", "errors", "rateLimited", "authFailed", "skipped", "latencyMs")
            VALUES (${r.day}::date, ${r.providerRef}, ${r.keyRef}, ${r.provider}, ${r.requests}, ${r.ok}, ${r.errors}, ${r.rateLimited}, ${r.authFailed}, ${r.skipped}, ${r.latencyMs})
            ON CONFLICT ("day", "providerRef", "keyRef") DO UPDATE SET
              "requests" = ip_provider_usage."requests" + EXCLUDED."requests",
              "ok" = ip_provider_usage."ok" + EXCLUDED."ok",
              "errors" = ip_provider_usage."errors" + EXCLUDED."errors",
              "rateLimited" = ip_provider_usage."rateLimited" + EXCLUDED."rateLimited",
              "authFailed" = ip_provider_usage."authFailed" + EXCLUDED."authFailed",
              "skipped" = ip_provider_usage."skipped" + EXCLUDED."skipped",
              "latencyMs" = ip_provider_usage."latencyMs" + EXCLUDED."latencyMs"`;
        }
      } catch (err) {
        this.buffer.restore(rows);
        this.logger.warn(`could not store usage counters, will retry: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Deletes usage older than the retention window; called by maintenance. */
  async pruneUsage(): Promise<number> {
    const cutoff = new Date(Date.now() - USAGE_KEEP_DAYS * 86_400_000);
    return (await this.prisma.ipProviderUsage.deleteMany({ where: { day: { lt: cutoff } } })).count;
  }

  async usage(days: number): Promise<{ points: UsagePoint[]; byProvider: Record<string, UsageTotals>; byKey: Record<string, UsageTotals> }> {
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const stored = await this.prisma.ipProviderUsage.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } });
    const merged = new Map<string, UsageRow>();
    const put = (r: UsageRow): void => {
      const id = `${r.day}|${r.providerRef}|${r.keyRef}`;
      const cur = merged.get(id);
      if (!cur) merged.set(id, { ...r });
      else {
        cur.requests += r.requests;
        cur.ok += r.ok;
        cur.errors += r.errors;
        cur.rateLimited += r.rateLimited;
        cur.authFailed += r.authFailed;
        cur.skipped += r.skipped;
        cur.latencyMs += r.latencyMs;
      }
    };
    for (const r of stored) put({ ...r, day: r.day.toISOString().slice(0, 10), latencyMs: Number(r.latencyMs) });
    for (const r of this.buffer.pending()) put(r);

    const byProvider: Record<string, UsageTotals & { latencySum?: number }> = {};
    const byKey: Record<string, UsageTotals & { latencySum?: number }> = {};
    const points: UsagePoint[] = [];
    for (const r of [...merged.values()].sort((a, b) => a.day.localeCompare(b.day))) {
      addRow((byProvider[r.providerRef] ??= emptyTotals()), r);
      if (r.keyRef) addRow((byKey[r.keyRef] ??= emptyTotals()), r);
      const p = emptyTotals() as UsageTotals & { latencySum?: number };
      addRow(p, r);
      points.push({ day: r.day, providerRef: r.providerRef, keyRef: r.keyRef, provider: r.provider, ...finish(p) });
    }
    return {
      points,
      byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, finish(v)])),
      byKey: Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, finish(v)])),
    };
  }

  // ---------- views

  private keyView(k: { id: string; label: string; hint: string; enabled: boolean; weight: number; dailyLimit: number | null; createdAt: Date }, state: KeyState | undefined): KeyView {
    return {
      id: k.id,
      label: k.label,
      hint: k.hint,
      enabled: k.enabled,
      weight: k.weight,
      dailyLimit: k.dailyLimit,
      usedToday: state?.usedToday ?? 0,
      coolingUntil: state?.coolingUntil ? new Date(state.coolingUntil).toISOString() : null,
      lastError: state?.lastError ?? null,
      lastErrorAt: state?.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : null,
      broken: state?.broken ?? null,
      createdAt: k.createdAt.toISOString(),
    };
  }

  private status(enabled: boolean, d: ProviderDescriptor | undefined, keys: KeyView[]): { status: ProviderStatus; detail: string | null } {
    if (!enabled) return { status: 'disabled', detail: 'Turned off' };
    if (!d) return { status: 'down', detail: 'This version does not know this provider' };
    if (!d.remote) return { status: 'ok', detail: null };
    if (keys.length === 0 && needsKey(d)) return { status: 'down', detail: 'Add an API key' };
    if (keys.length === 0) return { status: 'ok', detail: null };
    const usable = keys.filter((k) => k.enabled && !k.broken && !k.coolingUntil && (k.dailyLimit === null || k.usedToday < k.dailyLimit));
    if (usable.length === 0) {
      const cooling = keys.find((k) => k.coolingUntil);
      const limited = keys.find((k) => k.dailyLimit !== null && k.usedToday >= k.dailyLimit);
      const broken = keys.find((k) => k.broken);
      return { status: 'down', detail: cooling ? `Rate limited or rejected: ${cooling.lastError ?? 'cooling down'}` : limited ? 'Daily limit reached on every key' : broken ? `Misconfigured: ${broken.broken}` : 'No enabled key' };
    }
    if (usable.length < keys.filter((k) => k.enabled).length) return { status: 'degraded', detail: 'Some keys are cooling down, limited or misconfigured' };
    return { status: 'ok', detail: null };
  }

  /** Everything the dashboard page needs in one call. Secrets are not included. */
  async overview(): Promise<IpOverview> {
    const rows = await this.prisma.ipProvider.findMany({ include: { keys: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    const providers: ProviderView[] = rows.map((row) => {
      const d = descriptor(row.provider);
      const state = this.pools.get(row.id)?.poolState();
      const keys = row.keys.map((k) => this.keyView(k, state?.keys.find((s) => s.id === k.id)));
      const st = this.status(row.enabled, d, keys);
      return {
        id: row.id,
        provider: row.provider,
        label: row.label,
        enabled: row.enabled,
        priority: row.priority,
        sharePercent: row.sharePercent,
        dailyLimit: row.dailyLimit,
        strategy: row.strategy === 'failover' ? 'failover' : 'weighted',
        settings: this.stringValues(row.settings),
        keys,
        usedToday: state?.usedToday ?? 0,
        status: st.status,
        statusDetail: st.detail,
        createdAt: row.createdAt.toISOString(),
      };
    });
    const today = await this.usage(1);
    const environment = (this.reloadable?.envSources ?? []).map((s) => ({ ref: s.ref ?? `env:${s.name}`, provider: s.name, usage: today.byProvider[s.ref ?? `env:${s.name}`] ?? finish(emptyTotals()) }));
    const total = emptyTotals() as UsageTotals & { latencySum?: number };
    for (const t of Object.values(today.byProvider)) {
      total.requests += t.requests;
      total.ok += t.ok;
      total.errors += t.errors;
      total.rateLimited += t.rateLimited;
      total.authFailed += t.authFailed;
      total.skipped += t.skipped;
    }
    const stats: IpIntelStats = this.reloadable?.stats() ?? { lookups: 0, memoryHits: 0, sharedHits: 0, providerCalls: 0, failures: 0, skippedPrivate: 0 };
    return {
      registry: REGISTRY.map(info),
      providers,
      environment,
      cache: {
        redis: this.redis.available,
        sharedEnabled: this.settings.get<boolean>('ip.sharedCache'),
        ttlHours: this.settings.get<number>('ip.cacheHours'),
        timeoutMs: this.settings.get<number>('ip.timeoutMs'),
        ...stats,
      },
      files: this.reloadable ? this.reloadable.files.sizes : null,
      settings: this.settings.list().filter((s) => s.group === 'ip'),
      totalsToday: { ...total, avgLatencyMs: null },
      canReload: this.reloadable !== null,
    };
  }

  // ---------- changes

  private descriptorOrThrow(id: string): ProviderDescriptor {
    const d = descriptor(id);
    if (!d) throw ApiError.badRequest(`Unknown provider "${id}". Known: ${REGISTRY.map((x) => x.id).join(', ')}`, 'unknown_provider');
    return d;
  }

  /** Keeps only the descriptor's fields of one scope, as strings. */
  private pick(d: ProviderDescriptor, scope: 'key' | 'provider', input: Record<string, string | boolean | number> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of d.fields) {
      if (f.scope !== scope) continue;
      const v = input?.[f.name];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      out[f.name] = String(v).trim();
    }
    return out;
  }

  private sealKey(d: ProviderDescriptor, values: Record<string, string>): { sealed: string; hint: string } {
    const main = d.fields.find((f) => f.scope === 'key' && f.secret);
    return { sealed: sealSecret(JSON.stringify(values), this.env.TOKEN_SECRET), hint: maskHint(main ? values[main.name] : Object.values(values)[0]) };
  }

  /** With a key (or for providers that need none), every rule applies; a key-less provider that needs one only checks settings. */
  private checkValues(d: ProviderDescriptor, settings: Record<string, string>, keyValues: Record<string, string> | null): void {
    const problems = keyValues || !needsKey(d) ? validateValues(d, { ...settings, ...(keyValues ?? {}) }, 'all') : validateValues(d, settings, 'provider');
    if (problems.length > 0) throw ApiError.badRequest([...new Set(problems)].join('. '), 'invalid_provider');
  }

  async createProvider(body: unknown): Promise<ProviderView> {
    const parsed = createProviderSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error);
    const p = parsed.data;
    const d = this.descriptorOrThrow(p.provider);
    if ((await this.prisma.ipProvider.count()) >= MAX_PROVIDERS) throw new ApiError(409, 'limit_reached', `At most ${MAX_PROVIDERS} providers`);
    if (!d.remote && p.key) throw ApiError.badRequest(`${d.label} takes no key`, 'invalid_provider');
    const settings = this.pick(d, 'provider', p.settings);
    const keyValues = p.key ? this.pick(d, 'key', p.key.values) : null;
    this.checkValues(d, settings, keyValues);
    const created = await this.prisma.ipProvider.create({
      data: {
        provider: d.id,
        label: p.label ?? d.label,
        enabled: p.enabled ?? true,
        priority: p.priority ?? 100,
        sharePercent: p.sharePercent ?? 100,
        dailyLimit: p.dailyLimit ?? null,
        strategy: p.strategy ?? 'weighted',
        settings,
        ...(p.key && keyValues
          ? {
              keys: {
                create: {
                  label: p.key.label ?? 'Key 1',
                  enabled: p.key.enabled ?? true,
                  weight: p.key.weight ?? 1,
                  dailyLimit: p.key.dailyLimit ?? null,
                  ...this.sealKey(d, keyValues),
                },
              },
            }
          : {}),
      },
    });
    await this.reload();
    return this.viewOne(created.id);
  }

  private async viewOne(id: string): Promise<ProviderView> {
    const o = await this.overview();
    const v = o.providers.find((x) => x.id === id);
    if (!v) throw ApiError.notFound('Provider not found');
    return v;
  }

  private uuid(id: string, what: string): string {
    if (!UUID.test(id)) throw ApiError.notFound(`${what} not found`);
    return id;
  }

  async updateProvider(id: string, body: unknown): Promise<ProviderView> {
    const parsed = updateProviderSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error);
    const row = await this.prisma.ipProvider.findUnique({ where: { id: this.uuid(id, 'Provider') } });
    if (!row) throw ApiError.notFound('Provider not found');
    const d = this.descriptorOrThrow(row.provider);
    const { settings: incoming, ...rest } = parsed.data;
    let settings: Record<string, string> | undefined;
    if (incoming) {
      settings = this.pick(d, 'provider', incoming);
      const problems = validateValues(d, settings, 'provider');
      if (problems.length > 0) throw ApiError.badRequest(problems.join('. '), 'invalid_provider');
    }
    await this.prisma.ipProvider.update({ where: { id }, data: { ...rest, ...(settings ? { settings } : {}) } });
    await this.reload();
    return this.viewOne(id);
  }

  async deleteProvider(id: string): Promise<void> {
    const { count } = await this.prisma.ipProvider.deleteMany({ where: { id: this.uuid(id, 'Provider') } });
    if (count === 0) throw ApiError.notFound('Provider not found');
    await this.reload();
  }

  async addKey(providerId: string, body: unknown): Promise<ProviderView> {
    const parsed = newKey.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error);
    const row = await this.prisma.ipProvider.findUnique({ where: { id: this.uuid(providerId, 'Provider') }, include: { _count: { select: { keys: true } } } });
    if (!row) throw ApiError.notFound('Provider not found');
    const d = this.descriptorOrThrow(row.provider);
    if (!d.remote) throw ApiError.badRequest(`${d.label} takes no key`, 'invalid_provider');
    if (row._count.keys >= MAX_KEYS_PER_PROVIDER) throw new ApiError(409, 'limit_reached', `At most ${MAX_KEYS_PER_PROVIDER} keys per provider`);
    const values = this.pick(d, 'key', parsed.data.values);
    this.checkValues(d, this.stringValues(row.settings), values);
    await this.prisma.ipProviderKey.create({
      data: {
        providerId,
        label: parsed.data.label ?? `Key ${row._count.keys + 1}`,
        enabled: parsed.data.enabled ?? true,
        weight: parsed.data.weight ?? 1,
        dailyLimit: parsed.data.dailyLimit ?? null,
        ...this.sealKey(d, values),
      },
    });
    await this.reload();
    return this.viewOne(providerId);
  }

  async updateKey(providerId: string, keyId: string, body: unknown): Promise<ProviderView> {
    const parsed = updateKeySchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error);
    const key = await this.prisma.ipProviderKey.findFirst({ where: { id: this.uuid(keyId, 'Key'), providerId: this.uuid(providerId, 'Provider') }, include: { provider: true } });
    if (!key) throw ApiError.notFound('Key not found');
    const d = this.descriptorOrThrow(key.provider.provider);
    const { values, ...rest } = parsed.data;
    let sealed: { sealed: string; hint: string } | undefined;
    if (values) {
      const picked = this.pick(d, 'key', values);
      // Blank fields keep their saved value, so changing a label or one field never needs the secret again.
      const current = this.keyValues(key.sealed, key.id);
      const merged = { ...current, ...picked };
      this.checkValues(d, this.stringValues(key.provider.settings), merged);
      sealed = this.sealKey(d, merged);
    }
    await this.prisma.ipProviderKey.update({ where: { id: keyId }, data: { ...rest, ...(sealed ?? {}) } });
    await this.reload();
    return this.viewOne(providerId);
  }

  async deleteKey(providerId: string, keyId: string): Promise<ProviderView> {
    const { count } = await this.prisma.ipProviderKey.deleteMany({ where: { id: this.uuid(keyId, 'Key'), providerId: this.uuid(providerId, 'Provider') } });
    if (count === 0) throw ApiError.notFound('Key not found');
    await this.reload();
    return this.viewOne(providerId);
  }

  // ---------- test

  /**
   * One real lookup against a provider, to check a key before relying on it. Works on a saved provider (and key) or
   * on values typed into the form but not saved yet. The call goes straight to the provider, skipping the caches.
   */
  async test(body: unknown): Promise<{ ok: boolean; latencyMs: number; facts?: IpFacts; error?: string; status?: number | null }> {
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error);
    const t = parsed.data;
    if (!isIP(t.ip) || !isPublicIp(t.ip)) throw ApiError.badRequest('Enter a public IPv4 or IPv6 address', 'invalid_ip');

    let d: ProviderDescriptor;
    let settings: Record<string, string>;
    let values: Record<string, string>;
    let ref = 'test';
    let keyId = 'test';
    let live = false;
    if (t.providerId) {
      const row = await this.prisma.ipProvider.findUnique({ where: { id: this.uuid(t.providerId, 'Provider') }, include: { keys: { orderBy: { createdAt: 'asc' } } } });
      if (!row) throw ApiError.notFound('Provider not found');
      d = this.descriptorOrThrow(row.provider);
      settings = this.stringValues(row.settings);
      const key = t.keyId ? row.keys.find((k) => k.id === t.keyId) : row.keys[0];
      if (t.keyId && !key) throw ApiError.notFound('Key not found');
      values = key ? this.keyValues(key.sealed, key.id) : {};
      if (key) keyId = key.id;
      ref = row.id;
      live = true;
    } else if (t.provider) {
      d = this.descriptorOrThrow(t.provider);
      settings = this.pick(d, 'provider', t.settings);
      values = this.pick(d, 'key', t.values);
      this.checkValues(d, settings, needsKey(d) || Object.keys(values).length > 0 ? values : null);
    } else {
      throw ApiError.badRequest('Name a providerId or a provider', 'invalid_request');
    }
    if (!d.remote) throw ApiError.badRequest(`${d.label} reads request headers; there is nothing to call`, 'invalid_request');

    const secrets = Object.values(values);
    const started = Date.now();
    const source = pooledSource({
      ref,
      descriptor: d,
      settings,
      keys: needsKey(d) || Object.keys(values).length > 0 ? [{ id: keyId, label: 'test', values, weight: 1, dailyLimit: null, enabled: true }] : [],
      ...(live && this.reloadable ? { onUsage: this.reloadable.hub.emit } : {}),
    });
    try {
      const facts = await source.lookup(t.ip, { signal: AbortSignal.timeout(8000) });
      return { ok: true, latencyMs: Date.now() - started, facts };
    } catch (err) {
      const status = typeof (err as { status?: unknown }).status === 'number' ? ((err as { status: number }).status) : null;
      return { ok: false, latencyMs: Date.now() - started, error: mask(err instanceof Error ? err.message : String(err), secrets), status };
    }
  }
}
