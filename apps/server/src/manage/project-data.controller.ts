import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  type EventLabelResponse,
  type EventLabelsResponse,
  type EventResponse,
  type FraudModelsResponse,
  type AnalyticsResponse,
  type ClientsResponse,
  type GraphResponse,
  type PolicySimulation,
  type QualityResponse,
  type RingsResponse,
  type EventSearchResponse,
  type LinkedIdListResponse,
  type VisitorListResponse,
  type MatchKind,
  type TagValue,
  type UsageResponse,
  type VisitorHistoryResponse,
  type WebhookEndpointResponse,
} from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, requireProject } from '../common/auth.js';
import { decodeCursor, encodeCursor, MAX_PAGE_SIZE } from '../common/cursor.js';
import { uuidv7Time } from '../common/ids.js';
import { ENV, type Env } from '../config/env.js';
import { toEventResponse } from '../events/event-mapper.js';
import { FraudService } from '../fraud/fraud.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { VisitorsService } from '../visitors/visitors.service.js';
import { AnalyticsService } from './analytics.service.js';
import { InvestigateService } from './investigate.service.js';
import { uaLabels } from './ua-labels.js';
import { type DeliveryLogEntry, invalidFields, WebhookAdminService } from '../webhooks/webhook-admin.service.js';

const SUSPICIOUS_THRESHOLD = 70;

/** The fired signal ids and the browser and OS of one stored event, for list rows. */
function summarise(signals: unknown): { detected: string[]; browser: string | null; os: string | null; deviceType: string | null } {
  const s = (signals ?? {}) as { results?: Record<string, { detected?: boolean }>; attributes?: { userAgent?: string | null } };
  const ua = s.attributes?.userAgent ?? null;
  const labels = ua ? uaLabels(ua) : null;
  return {
    detected: Object.entries(s.results ?? {}).filter(([, r]) => r?.detected).map(([id]) => id),
    browser: labels?.browser ?? null,
    os: labels?.os ?? null,
    deviceType: labels?.deviceType ?? null,
  };
}
const DAY_MS = 24 * 60 * 60_000;

const searchSchema = z
  .object({
    linkedId: z.string().min(1).max(256).optional(),
    country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    ip: z.string().min(2).max(64).optional(),
    matchKind: z.enum(['new', 'token', 'match', 'conflict']).optional(),
    signal: z.string().regex(/^[A-Za-z]{2,40}$/).optional(),
    maxScore: z.coerce.number().int().min(0).max(100).optional(),
    visitorId: z.string().regex(/^[0-9A-Za-z]{20}$/).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  })
  .strict();

const csv = (max: number, re: RegExp) =>
  z.string().max(400).transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().regex(re)).max(max));

const ringsSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30), minVisitors: z.coerce.number().int().min(2).max(50).default(3) }).strict();
const graphSchema = z
  .object({
    type: z.enum(['visitor', 'account', 'ip']),
    id: z.string().min(1).max(256),
    days: z.coerce.number().int().min(1).max(90).default(30),
  })
  .strict();
const simulateSchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(30),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    signals: csv(30, /^[A-Za-z]{2,40}$/).optional(),
    countries: csv(30, /^[A-Za-z]{2}$/).optional(),
    notCountries: csv(30, /^[A-Za-z]{2}$/).optional(),
    matchKind: z.enum(['new', 'token', 'match', 'conflict']).optional(),
  })
  .strict();

const analyticsSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict();
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    cursor: z.string().regex(/^\d{1,5}$/).optional(),
    sort: z.enum(['recent', 'events', 'risk', 'new', 'devices']).default('recent'),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    q: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const usageSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).strict();

/**
 * Dashboard read access to a project's data, plus visitor deletion and webhook management.
 * Attack surface: IDOR (membership enforced by the guard; every query filters on projectId),
 * DoS (bounded pages and date windows, per-user limit), privilege (deletes, webhook
 * changes and fraud labels, which train the project's models, need admin).
 */
@Controller('v1/projects/:projectId')
export class ProjectDataController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly visitors: VisitorsService,
    private readonly webhooks: WebhookAdminService,
    private readonly fraud: FraudService,
    private readonly analytics: AnalyticsService,
    private readonly investigate: InvestigateService,
  ) {}

  private async scope(req: FastifyRequest): Promise<string> {
    const { projectId, userId } = requireProject(req);
    await this.rateLimit.enforce([
      { key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return projectId;
  }

  @Get('usage')
  @Auth('session')
  async usage(@Req() req: FastifyRequest, @Query() query: unknown): Promise<UsageResponse> {
    const projectId = await this.scope(req);
    const parsed = usageSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    const days = parsed.data.days;
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const since = new Date(today.getTime() - (days - 1) * DAY_MS);
    const rows = await this.prisma.$queryRaw<{ day: string; events: number; newVisitors: number; suspicious: number }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::int AS events,
             (count(*) FILTER (WHERE "matchKind" = 'new'))::int AS "newVisitors",
             (count(*) FILTER (WHERE "suspectScore" >= ${SUSPICIOUS_THRESHOLD}))::int AS suspicious
      FROM "events"
      WHERE "projectId" = ${projectId}::uuid AND "createdAt" >= ${since}
      GROUP BY 1`;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return {
      suspiciousThreshold: SUSPICIOUS_THRESHOLD,
      days: Array.from({ length: days }, (_, i) => {
        const day = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        const r = byDay.get(day);
        return { day, events: r?.events ?? 0, newVisitors: r?.newVisitors ?? 0, suspicious: r?.suspicious ?? 0 };
      }),
    };
  }

  @Get('analytics')
  @Auth('session')
  async analyticsOverview(@Req() req: FastifyRequest, @Query() query: unknown): Promise<AnalyticsResponse> {
    const projectId = await this.scope(req);
    const parsed = analyticsSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    return this.analytics.overview(projectId, parsed.data.days);
  }

  @Get('clients')
  @Auth('session')
  async clients(@Req() req: FastifyRequest, @Query() query: unknown): Promise<ClientsResponse> {
    const projectId = await this.scope(req);
    const parsed = analyticsSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    return this.analytics.clients(projectId, parsed.data.days);
  }

  @Get('rings')
  @Auth('session')
  async rings(@Req() req: FastifyRequest, @Query() query: unknown): Promise<RingsResponse> {
    const projectId = await this.scope(req);
    const parsed = ringsSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    return this.investigate.rings(projectId, parsed.data.days, parsed.data.minVisitors);
  }

  @Get('graph')
  @Auth('session')
  async graph(@Req() req: FastifyRequest, @Query() query: unknown): Promise<GraphResponse> {
    const projectId = await this.scope(req);
    const parsed = graphSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    return this.investigate.graph(projectId, { type: parsed.data.type, id: parsed.data.id }, parsed.data.days);
  }

  @Get('policy/simulate')
  @Auth('session')
  async simulate(@Req() req: FastifyRequest, @Query() query: unknown): Promise<PolicySimulation> {
    const projectId = await this.scope(req);
    const parsed = simulateSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    const { days, countries, notCountries, ...rule } = parsed.data;
    return this.investigate.simulate(projectId, days, {
      ...rule,
      ...(countries ? { countries: countries.map((c) => c.toUpperCase()) } : {}),
      ...(notCountries ? { notCountries: notCountries.map((c) => c.toUpperCase()) } : {}),
    });
  }

  @Get('quality')
  @Auth('session')
  async quality(@Req() req: FastifyRequest, @Query() query: unknown): Promise<QualityResponse> {
    const projectId = await this.scope(req);
    const parsed = analyticsSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    return this.investigate.quality(projectId, parsed.data.days);
  }

  @Get('visitors')
  @Auth('session')
  async visitorList(@Req() req: FastifyRequest, @Query() query: unknown): Promise<VisitorListResponse> {
    const projectId = await this.scope(req);
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    if (parsed.data.sort === 'devices') throw ApiError.badRequest('sort devices applies to accounts only', 'invalid_sort');
    const q = parsed.data;
    return this.analytics.visitors(projectId, {
      limit: q.limit, offset: q.cursor ? Number(q.cursor) : 0, sort: q.sort as 'recent' | 'events' | 'risk' | 'new', minScore: q.minScore, q: q.q,
    });
  }

  @Get('accounts')
  @Auth('session')
  async accountList(@Req() req: FastifyRequest, @Query() query: unknown): Promise<LinkedIdListResponse> {
    const projectId = await this.scope(req);
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    if (parsed.data.sort === 'new') throw ApiError.badRequest('sort new applies to visitors only', 'invalid_sort');
    const q = parsed.data;
    return this.analytics.linkedIds(projectId, {
      limit: q.limit, offset: q.cursor ? Number(q.cursor) : 0, sort: q.sort as 'recent' | 'events' | 'risk' | 'devices', q: q.q,
    });
  }

  @Get('events')
  @Auth('session')
  async search(@Req() req: FastifyRequest, @Query() query: unknown): Promise<EventSearchResponse> {
    const projectId = await this.scope(req);
    const parsed = searchSchema.safeParse(query);
    if (!parsed.success) throw invalidFields(parsed.error);
    const q = parsed.data;
    let cursor = null;
    if (q.cursor !== undefined) {
      cursor = decodeCursor(q.cursor);
      if (!cursor) throw ApiError.badRequest('cursor is not valid', 'invalid_cursor');
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = new Date(q.from);
    if (q.to) createdAt.lt = new Date(q.to);
    const where: Prisma.EventWhereInput = {
      projectId,
      ...(q.linkedId ? { linkedId: q.linkedId } : {}),
      ...(q.visitorId ? { visitorId: q.visitorId } : {}),
      ...(q.minScore !== undefined || q.maxScore !== undefined
        ? { suspectScore: { ...(q.minScore !== undefined ? { gte: q.minScore } : {}), ...(q.maxScore !== undefined ? { lte: q.maxScore } : {}) } }
        : {}),
      ...(q.country ? { country: q.country.toUpperCase() } : {}),
      ...(q.ip ? { ip: q.ip } : {}),
      ...(q.matchKind ? { matchKind: q.matchKind } : {}),
      ...(q.signal ? { signals: { path: ['results', q.signal, 'detected'], equals: true } } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
      ...(cursor
        ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] }
        : {}),
    };
    const rows = await this.prisma.event.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: {
        id: true,
        createdAt: true,
        visitorId: true,
        matchKind: true,
        confidence: true,
        suspectScore: true,
        linkedId: true,
        tags: true,
        ip: true,
        country: true,
        signals: true,
      },
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      events: page.map((e) => ({
        eventId: e.id,
        visitorId: e.visitorId,
        createdAt: e.createdAt.toISOString(),
        matchKind: e.matchKind as MatchKind,
        confidence: e.confidence,
        suspectScore: e.suspectScore,
        linkedId: e.linkedId,
        tags: (e.tags as Record<string, TagValue> | null) ?? null,
        ip: e.ip,
        country: e.country,
        ...summarise(e.signals),
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  /** Unlike GET /v1/events/:id, no verification window: this is for humans investigating. */
  @Get('events/:eventId')
  @Auth('session')
  async event(@Req() req: FastifyRequest, @Param('eventId') eventId: string): Promise<EventResponse> {
    const projectId = await this.scope(req);
    const createdAt = uuidv7Time(eventId);
    if (!createdAt) throw ApiError.badRequest('eventId is not a valid event id', 'invalid_event_id');
    const row = await this.prisma.event.findFirst({ where: { id: eventId, createdAt, projectId } });
    if (!row) throw ApiError.notFound('Event not found');
    return toEventResponse(row, this.env.EVENT_VERIFY_WINDOW_MINUTES);
  }

  @Get('events/:eventId/labels')
  @Auth('session')
  async eventLabels(@Req() req: FastifyRequest, @Param('eventId') eventId: string): Promise<EventLabelsResponse> {
    return this.fraud.labelsOf(await this.scope(req), eventId);
  }

  @Put('events/:eventId/labels/:label')
  @Auth('session')
  @MinRole('admin')
  async labelEvent(
    @Req() req: FastifyRequest,
    @Param('eventId') eventId: string,
    @Param('label') label: string,
    @Body() body: unknown,
  ): Promise<EventLabelResponse> {
    return this.fraud.label(await this.scope(req), eventId, label, body);
  }

  @Delete('events/:eventId/labels/:label')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(204)
  async unlabelEvent(@Req() req: FastifyRequest, @Param('eventId') eventId: string, @Param('label') label: string): Promise<void> {
    await this.fraud.unlabel(await this.scope(req), eventId, label);
  }

  @Get('fraud-models')
  @Auth('session')
  async fraudModels(@Req() req: FastifyRequest): Promise<FraudModelsResponse> {
    return this.fraud.list(await this.scope(req));
  }

  @Post('fraud-models/train')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(200)
  async trainFraudModels(@Req() req: FastifyRequest): Promise<FraudModelsResponse> {
    return this.fraud.train(await this.scope(req));
  }

  @Get('visitors/:visitorId')
  @Auth('session')
  async visitor(
    @Req() req: FastifyRequest,
    @Param('visitorId') visitorId: string,
    @Query('cursor') cursor: unknown,
    @Query('limit') limit: unknown,
  ): Promise<VisitorHistoryResponse> {
    return this.visitors.history(await this.scope(req), visitorId, cursor, limit);
  }

  @Delete('visitors/:visitorId')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(204)
  async deleteVisitor(@Req() req: FastifyRequest, @Param('visitorId') visitorId: string): Promise<void> {
    await this.visitors.remove(await this.scope(req), visitorId);
  }

  @Get('webhooks')
  @Auth('session')
  async listWebhooks(@Req() req: FastifyRequest): Promise<{ endpoints: WebhookEndpointResponse[] }> {
    return this.webhooks.list(await this.scope(req));
  }

  @Post('webhooks')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(201)
  async createWebhook(@Req() req: FastifyRequest, @Body() body: unknown): Promise<WebhookEndpointResponse> {
    return this.webhooks.create(await this.scope(req), body);
  }

  @Delete('webhooks/:id')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(204)
  async deleteWebhook(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    await this.webhooks.remove(await this.scope(req), id);
  }

  @Get('webhooks/:id/deliveries')
  @Auth('session')
  async deliveries(@Req() req: FastifyRequest, @Param('id') id: string): Promise<{ deliveries: DeliveryLogEntry[] }> {
    return this.webhooks.deliveries(await this.scope(req), id);
  }
}
