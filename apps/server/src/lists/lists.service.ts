import { isIP } from 'node:net';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { ENV, type Env } from '../config/env.js';
import { CidrSet } from '../intel/cidr.js';
import { PrismaService } from '../infra/prisma.service.js';

export const LIST_KINDS = ['ip', 'cidr', 'visitor', 'device', 'linked'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export type ListAction = 'allow' | 'block';

export const MAX_ENTRIES = 1000;
const CACHE_MS = 15_000;
const FLUSH_MS = 10_000;

/** What an event matched, kept on the event so the dashboard can say why a score was overridden. */
export interface ListMatch {
  action: ListAction;
  kind: ListKind;
  value: string;
  note: string | null;
  entryId: string;
  /** The score the signals alone gave, before the list overrode it. */
  scoreBefore: number;
}

interface Entry {
  id: string;
  kind: ListKind;
  value: string;
  action: ListAction;
  note: string | null;
  cidr?: CidrSet;
}

interface Compiled {
  at: number;
  ranges: Entry[];
  exact: Map<string, Entry>;
}

export const entrySchema = z
  .object({
    kind: z.enum(LIST_KINDS),
    value: z.string().trim().min(1).max(256),
    action: z.enum(['allow', 'block']),
    note: z.string().trim().max(200).optional(),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

/** Checks and normalises a value for its kind; throws a 400 naming what is wrong. */
export function normalizeValue(kind: ListKind, raw: string): string {
  const v = raw.trim();
  if (kind === 'ip') {
    if (isIP(v) === 0) throw ApiError.badRequest('Enter a valid IPv4 or IPv6 address', 'invalid_value');
    return v.toLowerCase();
  }
  if (kind === 'cidr') {
    const m = /^([^/\s]+)\/(\d{1,3})$/.exec(v);
    if (!m || isIP(m[1] as string) === 0 || CidrSet.from([v]).size !== 1) throw ApiError.badRequest('Enter a range like 203.0.113.0/24', 'invalid_value');
    return v.toLowerCase();
  }
  if (kind === 'visitor' || kind === 'device') {
    if (!/^[\w-]{6,64}$/.test(v)) throw ApiError.badRequest(`Enter a ${kind} id (letters, digits, - and _)`, 'invalid_value');
    return v;
  }
  if (!/^[\x20-\x7e]{1,256}$/.test(v)) throw ApiError.badRequest('A linked id is printable text up to 256 characters', 'invalid_value');
  return v;
}

/**
 * Per-project allow and block lists. An event that matches one gets a fixed score (block 100, allow 0) with the signal
 * score kept beside it; if it matches both, the allow entry wins, so a single trusted address can sit inside a blocked
 * range. Entries are cached for 15 seconds and the cache is dropped when this instance changes them.
 */
@Injectable()
export class ListsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Lists');
  private readonly cache = new Map<string, Compiled>();
  private readonly hits = new Map<string, { n: number; at: Date }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) _env: Env,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  private async compiled(projectId: string): Promise<Compiled> {
    const hit = this.cache.get(projectId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const rows = await this.prisma.listEntry.findMany({
      where: { projectId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      take: MAX_ENTRIES,
    });
    const ranges: Entry[] = [];
    const exact = new Map<string, Entry>();
    for (const r of rows) {
      const e: Entry = { id: r.id, kind: r.kind as ListKind, value: r.value, action: r.action === 'allow' ? 'allow' : 'block', note: r.note };
      if (e.kind === 'cidr') ranges.push({ ...e, cidr: CidrSet.from([e.value]) });
      else if (e.kind === 'ip') ranges.push({ ...e, cidr: CidrSet.from([e.value]) });
      else exact.set(`${e.kind}:${e.value}`, e);
    }
    const compiled = { at: Date.now(), ranges, exact };
    this.cache.set(projectId, compiled);
    return compiled;
  }

  /** The entry an event matches, allow before block; null when none. */
  async match(projectId: string, who: { ip: string; visitorId: string; deviceId: string; linkedId: string | null }): Promise<Entry | null> {
    const c = await this.compiled(projectId);
    if (c.ranges.length === 0 && c.exact.size === 0) return null;
    const found: Entry[] = [];
    for (const r of c.ranges) if (r.cidr?.has(who.ip)) found.push(r);
    for (const key of [`visitor:${who.visitorId}`, `device:${who.deviceId}`, ...(who.linkedId ? [`linked:${who.linkedId}`] : [])]) {
      const e = c.exact.get(key);
      if (e) found.push(e);
    }
    const winner = found.find((e) => e.action === 'allow') ?? found[0] ?? null;
    if (winner) {
      const cur = this.hits.get(winner.id);
      this.hits.set(winner.id, { n: (cur?.n ?? 0) + 1, at: new Date() });
    }
    return winner;
  }

  /** Writes the hit counters collected since the last flush. Best effort: a lost count is not worth failing a request. */
  async flush(): Promise<void> {
    if (this.hits.size === 0) return;
    const batch = [...this.hits.entries()];
    this.hits.clear();
    for (const [id, h] of batch) {
      try {
        await this.prisma.listEntry.updateMany({ where: { id }, data: { hits: { increment: h.n }, lastHitAt: h.at } });
      } catch (err) {
        this.logger.warn(`could not store list hit counts: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
  }
}
