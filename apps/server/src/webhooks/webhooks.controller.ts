import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { type WebhookEndpointResponse } from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { WebhookAdminService } from './webhook-admin.service.js';

/**
 * Attack surface: SSRF (https only, no credentials, private/loopback targets refused here
 * and re-checked against the resolved addresses on every delivery, no redirects followed,
 * capped response and timeout), IDOR (scoped by project, identical 404s), resource abuse
 * (max 10 endpoints per project, per-key rate limit). The signing secret is shown once.
 */
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly admin: WebhookAdminService,
  ) {}

  private async project(req: FastifyRequest): Promise<string> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return key.projectId;
  }

  @Post()
  @Auth('secret')
  @HttpCode(201)
  async create(@Req() req: FastifyRequest, @Body() body: unknown): Promise<WebhookEndpointResponse> {
    return this.admin.create(await this.project(req), body);
  }

  @Get()
  @Auth('secret')
  async list(@Req() req: FastifyRequest): Promise<{ endpoints: WebhookEndpointResponse[] }> {
    return this.admin.list(await this.project(req));
  }

  @Delete(':id')
  @Auth('secret')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    await this.admin.remove(await this.project(req), id);
  }
}
