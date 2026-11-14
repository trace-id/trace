import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { WEBHOOK_TYPES, type WebhookEndpointResponse, type WebhookType } from '@tbdname/signals/api';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { validateWebhookUrl } from './net-guard.js';
import { newWebhookSecret, sealSecret } from './secret-box.js';
import { WebhookService } from './webhook.service.js';

const MAX_ENDPOINTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const createSchema = z
  .object({
    url: z.string().min(1).max(2048),
    events: z
      .array(z.enum(WEBHOOK_TYPES))
      .min(1)
      .max(WEBHOOK_TYPES.length)
      .refine((e) => new Set(e).size === e.length, 'events must be unique'),
    flagThreshold: z.number().int().min(1).max(100).optional(),
  })
  .strict();

interface EndpointRow {
  id: string;
  url: string;
  events: string[];
  flagThreshold: number;
  enabled: boolean;
  createdAt: Date;
}

function toResponse(e: EndpointRow, secret?: string): WebhookEndpointResponse {
  return {
    id: e.id,
    url: e.url,
    events: e.events as WebhookType[],
    flagThreshold: e.flagThreshold,
    enabled: e.enabled,
    createdAt: e.createdAt.toISOString(),
    ...(secret ? { secret } : {}),
  };
}

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
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly webhooks: WebhookService,
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
    const projectId = await this.project(req);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
      throw ApiError.badRequest(`Invalid fields: ${paths.join(', ')}`);
    }
    const check = validateWebhookUrl(parsed.data.url, this.env.WEBHOOK_ALLOW_INSECURE);
    if (!check.ok) throw ApiError.badRequest(check.message, 'invalid_url');
    if ((await this.prisma.webhookEndpoint.count({ where: { projectId } })) >= MAX_ENDPOINTS) {
      throw new ApiError(409, 'limit_reached', `At most ${MAX_ENDPOINTS} webhook endpoints per project`);
    }
    const secret = newWebhookSecret();
    const row = await this.prisma.webhookEndpoint.create({
      data: {
        projectId,
        url: check.url.toString(),
        secretEnc: sealSecret(secret, this.env.TOKEN_SECRET),
        events: parsed.data.events,
        flagThreshold: parsed.data.flagThreshold ?? 70,
      },
    });
    this.webhooks.invalidate(projectId);
    return toResponse(row, secret);
  }

  @Get()
  @Auth('secret')
  async list(@Req() req: FastifyRequest): Promise<{ endpoints: WebhookEndpointResponse[] }> {
    const projectId = await this.project(req);
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return { endpoints: rows.map((r) => toResponse(r)) };
  }

  @Delete(':id')
  @Auth('secret')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    const projectId = await this.project(req);
    if (!UUID.test(id)) throw ApiError.notFound('Webhook endpoint not found');
    const { count } = await this.prisma.webhookEndpoint.deleteMany({ where: { id, projectId } });
    if (count === 0) throw ApiError.notFound('Webhook endpoint not found');
    this.webhooks.invalidate(projectId);
  }
}
