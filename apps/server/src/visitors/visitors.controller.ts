import { Controller, Delete, Get, HttpCode, Inject, Param, Query, Req } from '@nestjs/common';
import { type VisitorHistoryResponse } from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { VisitorsService } from './visitors.service.js';

/**
 * Attack surface: IDOR (every query is scoped by the key's project; foreign and missing
 * visitors both 404), enumeration (119-bit random ids), DoS (per-key limit, page size <= 50,
 * keyset pagination so deep pages cost the same as the first). DELETE is irreversible and
 * removes the visitor, its buckets, events and webhook deliveries (FK cascade).
 */
@Controller('v1/visitors')
export class VisitorsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly visitors: VisitorsService,
  ) {}

  private async project(req: FastifyRequest): Promise<string> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return key.projectId;
  }

  @Get(':visitorId')
  @Auth('secret')
  async history(
    @Req() req: FastifyRequest,
    @Param('visitorId') visitorId: string,
    @Query('cursor') cursor: unknown,
    @Query('limit') limit: unknown,
  ): Promise<VisitorHistoryResponse> {
    return this.visitors.history(await this.project(req), visitorId, cursor, limit);
  }

  @Delete(':visitorId')
  @Auth('secret')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('visitorId') visitorId: string): Promise<void> {
    await this.visitors.remove(await this.project(req), visitorId);
  }
}
