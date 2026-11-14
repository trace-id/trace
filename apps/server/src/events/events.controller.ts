import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { type EventResponse } from '@tbdname/signals/api';
import { type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireAuth } from '../common/auth.js';
import { uuidv7Time } from '../common/ids.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { toEventResponse } from './event-mapper.js';

/**
 * Attack surface: IDOR (lookup is scoped by the key's project; another project's event is a
 * plain 404), enumeration (ids are UUIDv7 with 74 random bits; same 404 for missing and
 * foreign), replay (events older than the verify window return 410), DoS (per-key limit).
 */
@Controller('v1/events')
export class EventsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(':eventId')
  @Auth('secret')
  async get(@Req() req: FastifyRequest, @Param('eventId') eventId: string): Promise<EventResponse> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    const createdAt = uuidv7Time(eventId);
    if (!createdAt) throw ApiError.badRequest('eventId is not a valid event id', 'invalid_event_id');

    const row = await this.prisma.event.findFirst({ where: { id: eventId, createdAt, projectId: key.projectId } });
    if (!row) throw ApiError.notFound('Event not found');

    if (Date.now() - row.createdAt.getTime() > this.env.EVENT_VERIFY_WINDOW_MINUTES * 60_000) {
      throw new ApiError(410, 'event_expired', 'Event is older than the verification window');
    }
    return toEventResponse(row, this.env.EVENT_VERIFY_WINDOW_MINUTES);
  }
}
