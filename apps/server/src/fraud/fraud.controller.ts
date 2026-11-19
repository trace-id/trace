import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { type EventLabelResponse, type FraudModelsResponse } from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { FraudService } from './fraud.service.js';

/**
 * Attack surface: IDOR (labels and models are scoped by the key's project; a foreign event is a plain 404), poisoning
 * (only the secret key can label, so only the customer's backend trains its own models), resource abuse (20 fraud
 * types per project, 50k newest labels per type used, per-key rate limit).
 */
@Controller('v1')
export class FraudController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly fraud: FraudService,
  ) {}

  private async project(req: FastifyRequest): Promise<string> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return key.projectId;
  }

  @Put('events/:eventId/labels/:label')
  @Auth('secret')
  async label(
    @Req() req: FastifyRequest,
    @Param('eventId') eventId: string,
    @Param('label') label: string,
    @Body() body: unknown,
  ): Promise<EventLabelResponse> {
    return this.fraud.label(await this.project(req), eventId, label, body);
  }

  @Delete('events/:eventId/labels/:label')
  @Auth('secret')
  @HttpCode(204)
  async unlabel(@Req() req: FastifyRequest, @Param('eventId') eventId: string, @Param('label') label: string): Promise<void> {
    await this.fraud.unlabel(await this.project(req), eventId, label);
  }

  @Get('fraud-models')
  @Auth('secret')
  async models(@Req() req: FastifyRequest): Promise<FraudModelsResponse> {
    return this.fraud.list(await this.project(req));
  }

  @Post('fraud-models/train')
  @Auth('secret')
  @HttpCode(200)
  async train(@Req() req: FastifyRequest): Promise<FraudModelsResponse> {
    return this.fraud.train(await this.project(req));
  }
}
