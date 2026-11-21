import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, requireProject } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { invalidFields } from '../webhooks/webhook-admin.service.js';
import { entrySchema, MAX_ENTRIES, normalizeValue, ListsService } from './lists.service.js';

const listQuery = z.object({ action: z.enum(['allow', 'block']).optional() }).strict();

export interface ListEntryView {
  id: string;
  kind: string;
  value: string;
  action: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  hits: number;
  lastHitAt: string | null;
}

/**
 * A project's allow and block lists. Writes need the admin role. A block entry makes matching events score 100 and an
 * allow entry makes them score 0, with the signal score kept on the event; allow wins when both match.
 */
@Controller('v1/projects/:projectId/lists')
export class ListsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly lists: ListsService,
  ) {}

  private async scope(req: FastifyRequest): Promise<{ projectId: string; userId: string }> {
    const { projectId, userId } = requireProject(req);
    await this.rateLimit.enforce([{ key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 }]);
    return { projectId, userId };
  }

  @Get()
  @Auth('session')
  async list(@Req() req: FastifyRequest, @Query() query: unknown): Promise<{ entries: ListEntryView[]; limit: number }> {
    const { projectId } = await this.scope(req);
    const parsed = listQuery.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    const rows = await this.prisma.listEntry.findMany({
      where: { projectId, ...(parsed.data.action ? { action: parsed.data.action } : {}), OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'desc' },
      take: MAX_ENTRIES,
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        value: r.value,
        action: r.action,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        hits: r.hits,
        lastHitAt: r.lastHitAt?.toISOString() ?? null,
      })),
      limit: MAX_ENTRIES,
    };
  }

  /** Adds an entry, or changes the action and note of the same value if it is already listed. */
  @Post()
  @Auth('session')
  @MinRole('admin')
  @HttpCode(201)
  async add(@Req() req: FastifyRequest, @Body() body: unknown): Promise<ListEntryView> {
    const { projectId, userId } = await this.scope(req);
    const parsed = entrySchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    const d = parsed.data;
    const value = normalizeValue(d.kind, d.value);
    const exists = await this.prisma.listEntry.findUnique({ where: { projectId_kind_value: { projectId, kind: d.kind, value } }, select: { id: true } });
    if (!exists && (await this.prisma.listEntry.count({ where: { projectId } })) >= MAX_ENTRIES) {
      throw new ApiError(409, 'limit_reached', `At most ${MAX_ENTRIES} entries per project`);
    }
    const expiresAt = d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null;
    const r = await this.prisma.listEntry.upsert({
      where: { projectId_kind_value: { projectId, kind: d.kind, value } },
      create: { projectId, kind: d.kind, value, action: d.action, note: d.note ?? null, createdBy: userId.slice(0, 64), expiresAt },
      update: { action: d.action, note: d.note ?? null, expiresAt },
    });
    this.lists.invalidate(projectId);
    return { id: r.id, kind: r.kind, value: r.value, action: r.action, note: r.note, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null, hits: r.hits, lastHitAt: r.lastHitAt?.toISOString() ?? null };
  }

  @Delete(':entryId')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('entryId') entryId: string): Promise<void> {
    const { projectId } = await this.scope(req);
    const { count } = await this.prisma.listEntry.deleteMany({ where: { id: /^[0-9a-f-]{36}$/.test(entryId) ? entryId : '00000000-0000-0000-0000-000000000000', projectId } });
    if (count === 0) throw ApiError.notFound('Entry not found');
    this.lists.invalidate(projectId);
  }
}
