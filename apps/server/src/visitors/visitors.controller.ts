import { Controller, Delete, Get, HttpCode, Inject, Param, Query, Req } from '@nestjs/common';
import { type MatchKind, type TagValue, type VisitorHistoryResponse } from '@tbdname/signals/api';
import { type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireAuth } from '../common/auth.js';
import { decodeCursor, encodeCursor, parseLimit } from '../common/cursor.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';

const VISITOR_ID = /^[0-9A-Za-z]{20}$/;

/**
 * Attack surface: IDOR (every query is scoped by the key's project; foreign and missing
 * visitors both 404), enumeration (119-bit random ids), DoS (per-key limit, page size <= 50,
 * keyset pagination so deep pages cost the same as the first). DELETE is irreversible and
 * removes the visitor, its buckets and all its events (FK cascade).
 */
@Controller('v1/visitors')
export class VisitorsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async scoped(req: FastifyRequest, visitorId: string): Promise<string> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    if (!VISITOR_ID.test(visitorId)) throw ApiError.badRequest('visitorId is not valid', 'invalid_visitor_id');
    return key.projectId;
  }

  @Get(':visitorId')
  @Auth('secret')
  async history(
    @Req() req: FastifyRequest,
    @Param('visitorId') visitorId: string,
    @Query('cursor') cursorParam: unknown,
    @Query('limit') limitParam: unknown,
  ): Promise<VisitorHistoryResponse> {
    const projectId = await this.scoped(req, visitorId);
    const limit = parseLimit(limitParam);
    if (limit === null) throw ApiError.badRequest('limit must be an integer from 1 to 50');
    let cursor = null;
    if (cursorParam !== undefined) {
      cursor = typeof cursorParam === 'string' ? decodeCursor(cursorParam) : null;
      if (!cursor) throw ApiError.badRequest('cursor is not valid', 'invalid_cursor');
    }

    const visitor = await this.prisma.visitor.findFirst({ where: { id: visitorId, projectId } });
    if (!visitor) throw ApiError.notFound('Visitor not found');

    const rows = await this.prisma.event.findMany({
      where: {
        projectId,
        visitorId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        createdAt: true,
        matchKind: true,
        confidence: true,
        suspectScore: true,
        linkedId: true,
        tags: true,
      },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      visitorId: visitor.id,
      firstSeenAt: visitor.firstSeenAt.toISOString(),
      lastSeenAt: visitor.lastSeenAt.toISOString(),
      eventCount: visitor.eventCount,
      events: page.map((e) => ({
        eventId: e.id,
        createdAt: e.createdAt.toISOString(),
        matchKind: e.matchKind as MatchKind,
        confidence: e.confidence,
        suspectScore: e.suspectScore,
        linkedId: e.linkedId,
        tags: (e.tags as Record<string, TagValue> | null) ?? null,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  @Delete(':visitorId')
  @Auth('secret')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('visitorId') visitorId: string): Promise<void> {
    const projectId = await this.scoped(req, visitorId);
    const { count } = await this.prisma.visitor.deleteMany({ where: { id: visitorId, projectId } });
    if (count === 0) throw ApiError.notFound('Visitor not found');
  }
}
