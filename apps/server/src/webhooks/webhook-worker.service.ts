import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type WebhookPayload, type WebhookType } from '@trace-id/signals/api';
import { describeError } from '../common/log-safe.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { openSecret } from './secret-box.js';
import { sendWebhook } from './sender.js';

const BATCH = 20;
/** Delay before attempt n+1 after n failures; after the last one the delivery is dead (~45 h total). */
export const BACKOFF_MS = [10e3, 60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

interface Claimed {
  id: string;
  endpointId: string;
  type: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

/**
 * Polls for due deliveries. Claims use FOR UPDATE SKIP LOCKED plus a lease (lockedUntil),
 * so several instances can run safely and a crashed instance's claims are retried.
 * Delivery is at-least-once; receivers dedupe on the payload id.
 */
@Injectable()
export class WebhookWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Webhooks');
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.WEBHOOK_ALLOW_INSECURE) {
      this.logger.warn('WEBHOOK_ALLOW_INSECURE is on: http and private-network webhook targets are allowed');
    }
    if (this.env.NODE_ENV !== 'test') this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => 0);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    let processed = 0;
    try {
      processed = await this.processDue();
    } catch (err) {
      this.logger.error(`webhook tick failed: ${describeError(err)}`);
    }
    this.schedule(processed === BATCH ? 0 : this.env.WEBHOOK_POLL_INTERVAL_MS);
  }

  /** Public for tests and manual runs. Returns how many deliveries were attempted. */
  processDue(): Promise<number> {
    this.running = this.run();
    return this.running;
  }

  private async run(): Promise<number> {
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE "webhook_deliveries" d
      SET "lockedUntil" = now() + interval '2 minutes', "attempts" = d."attempts" + 1
      FROM (
        SELECT "id" FROM "webhook_deliveries"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= now()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
        ORDER BY "nextAttemptAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      ) c
      WHERE d."id" = c."id"
      RETURNING d."id", d."endpointId", d."type", d."payload", d."attempts", d."createdAt"`;
    if (claimed.length === 0) return 0;

    const endpoints = new Map(
      (
        await this.prisma.webhookEndpoint.findMany({
          where: { id: { in: [...new Set(claimed.map((c) => c.endpointId))] } },
          select: { id: true, url: true, secretEnc: true, enabled: true },
        })
      ).map((e) => [e.id, e]),
    );

    await Promise.all(
      claimed.map(async (d) => {
        const endpoint = endpoints.get(d.endpointId);
        if (!endpoint || !endpoint.enabled) {
          await this.prisma.webhookDelivery.update({
            where: { id: d.id },
            data: { status: 'cancelled', lockedUntil: null },
          });
          return;
        }
        const payload: WebhookPayload = {
          id: d.id,
          type: d.type as WebhookType,
          createdAt: d.createdAt.toISOString(),
          data: d.payload as WebhookPayload['data'],
        };
        let secret: string;
        try {
          secret = openSecret(endpoint.secretEnc, this.env.TOKEN_SECRET);
        } catch {
          await this.prisma.webhookDelivery.update({
            where: { id: d.id },
            data: { status: 'dead', lockedUntil: null, lastError: 'secret_unreadable' },
          });
          return;
        }
        const result = await sendWebhook({
          url: endpoint.url,
          body: JSON.stringify(payload),
          secret,
          deliveryId: d.id,
          timeoutMs: this.env.WEBHOOK_TIMEOUT_MS,
          allowInsecure: this.env.WEBHOOK_ALLOW_INSECURE,
        });
        if (result.ok) {
          await this.prisma.webhookDelivery.update({
            where: { id: d.id },
            data: { status: 'succeeded', deliveredAt: new Date(), lastStatus: result.status, lastError: null, lockedUntil: null },
          });
          return;
        }
        const dead = d.attempts >= MAX_ATTEMPTS;
        await this.prisma.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: dead ? 'dead' : 'pending',
            nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[d.attempts - 1] ?? 0)),
            lastStatus: result.status,
            lastError: result.error,
            lockedUntil: null,
          },
        });
        if (dead) this.logger.warn(`delivery=${d.id} endpoint=${d.endpointId} dead after ${d.attempts} attempts`);
      }),
    );
    return claimed.length;
  }
}
