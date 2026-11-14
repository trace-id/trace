import { Injectable } from '@nestjs/common';
import { type MatchKind, type TagValue, type VisitorHistoryResponse } from '@tbdname/signals/api';
import { ApiError } from '../common/api-error.js';
import { decodeCursor, encodeCursor, parseLimit } from '../common/cursor.js';
import { PrismaService } from '../infra/prisma.service.js';

const VISITOR_ID = /^[0-9A-Za-z]{20}$/;

/** Every query is scoped by projectId; callers resolve the project from a key or a session. */
@Injectable()
export class VisitorsService {
  constructor(private readonly prisma: PrismaService) {}

  private check(visitorId: string): void {
    if (!VISITOR_ID.test(visitorId)) throw ApiError.badRequest('visitorId is not valid', 'invalid_visitor_id');
  }

  async history(projectId: string, visitorId: string, cursorParam: unknown, limitParam: unknown): Promise<VisitorHistoryResponse> {
    this.check(visitorId);
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
          ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, createdAt: true, matchKind: true, confidence: true, suspectScore: true, linkedId: true, tags: true },
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

  async remove(projectId: string, visitorId: string): Promise<void> {
    this.check(visitorId);
    const { count } = await this.prisma.visitor.deleteMany({ where: { id: visitorId, projectId } });
    if (count === 0) throw ApiError.notFound('Visitor not found');
  }
}
