import { Inject, Injectable } from '@nestjs/common';
import { WEBHOOK_TYPES, type WebhookEndpointResponse, type WebhookType } from '@tbdname/signals/api';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
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

export interface DeliveryLogEntry {
  id: string;
  eventId: string;
  type: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

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

export function invalidFields(error: z.ZodError): ApiError {
  const paths = [...new Set(error.issues.map((i) => i.path.join('.') || '(root)'))];
  return ApiError.badRequest(`Invalid fields: ${paths.join(', ')}`);
}

@Injectable()
export class WebhookAdminService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
  ) {}

  async create(projectId: string, body: unknown): Promise<WebhookEndpointResponse> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
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

  async list(projectId: string): Promise<{ endpoints: WebhookEndpointResponse[] }> {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return { endpoints: rows.map((r) => toResponse(r)) };
  }

  async remove(projectId: string, id: string): Promise<void> {
    if (!UUID.test(id)) throw ApiError.notFound('Webhook endpoint not found');
    const { count } = await this.prisma.webhookEndpoint.deleteMany({ where: { id, projectId } });
    if (count === 0) throw ApiError.notFound('Webhook endpoint not found');
    this.webhooks.invalidate(projectId);
  }

  async deliveries(projectId: string, id: string): Promise<{ deliveries: DeliveryLogEntry[] }> {
    if (!UUID.test(id)) throw ApiError.notFound('Webhook endpoint not found');
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!endpoint) throw ApiError.notFound('Webhook endpoint not found');
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        eventId: true,
        type: true,
        status: true,
        attempts: true,
        lastStatus: true,
        lastError: true,
        createdAt: true,
        deliveredAt: true,
        nextAttemptAt: true,
      },
    });
    return {
      deliveries: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt.toISOString(),
      })),
    };
  }
}
