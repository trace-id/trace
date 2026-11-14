import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from './prisma.service.js';

const MONTHS_AHEAD = 2;
const DELETE_BATCH = 5000;
const LEASE_NAME = 'maintenance';
const DAY_MS = 24 * 60 * 60_000;
/** Finished webhook deliveries hold a copy of the event; keep them only for debugging. */
const DELIVERY_RETENTION_DAYS = 7;

export interface RetentionResult {
  eventsDeleted: number;
  deliveriesDeleted: number;
  visitorsDeleted: number;
  partitionsDropped: number;
}

/**
 * Partition upkeep and retention. Runs at startup and every MAINTENANCE_INTERVAL_MINUTES.
 * A lease row makes sure only one instance works at a time, without a long transaction.
 * Deletes go in batches so they never lock the events table for long.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private readonly holder = randomUUID();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensurePartitions();
    if (this.env.NODE_ENV === 'test') return;
    void this.runScheduled();
    this.timer = setInterval(() => void this.runScheduled(), this.env.MAINTENANCE_INTERVAL_MINUTES * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runScheduled(): Promise<void> {
    try {
      if (!(await this.acquireLease())) return;
      await this.ensurePartitions();
      const r = await this.applyRetention();
      this.logger.log(
        `retention: events=${r.eventsDeleted} deliveries=${r.deliveriesDeleted} visitors=${r.visitorsDeleted} partitions=${r.partitionsDropped}`,
      );
    } catch (err) {
      this.logger.error(`maintenance failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async ensurePartitions(): Promise<void> {
    try {
      await this.prisma.$executeRaw`SELECT ensure_event_partitions(${MONTHS_AHEAD}::integer)`;
    } catch (err) {
      this.logger.error(`ensure_event_partitions failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  private async acquireLease(): Promise<boolean> {
    const until = new Date(Date.now() + this.env.MAINTENANCE_INTERVAL_MINUTES * 60_000);
    const claimed = await this.prisma.$executeRaw`
      INSERT INTO "maintenance_leases" ("name", "holder", "until")
      VALUES (${LEASE_NAME}, ${this.holder}, ${until})
      ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "until" = EXCLUDED."until"
      WHERE "maintenance_leases"."until" < now() OR "maintenance_leases"."holder" = EXCLUDED."holder"`;
    return claimed === 1;
  }

  /** Public so tests and operators can run it on demand. */
  async applyRetention(now: Date = new Date()): Promise<RetentionResult> {
    const maxDays = this.env.RETENTION_MAX_DAYS;
    const projects = await this.prisma.project.findMany({ select: { id: true, retentionDays: true } });
    let eventsDeleted = 0;
    let visitorsDeleted = 0;

    for (const project of projects) {
      const days = Math.min(Math.max(project.retentionDays, 1), maxDays);
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      for (;;) {
        const n = await this.prisma.$executeRaw`
          DELETE FROM "events" WHERE ("id", "createdAt") IN (
            SELECT "id", "createdAt" FROM "events"
            WHERE "projectId" = ${project.id}::uuid AND "createdAt" < ${cutoff}
            LIMIT ${DELETE_BATCH}
          )`;
        eventsDeleted += n;
        if (n < DELETE_BATCH) break;
      }
      for (;;) {
        const n = await this.prisma.$executeRaw`
          DELETE FROM "visitors" WHERE "id" IN (
            SELECT "id" FROM "visitors"
            WHERE "projectId" = ${project.id}::uuid AND "lastSeenAt" < ${cutoff}
            LIMIT ${DELETE_BATCH}
          )`;
        visitorsDeleted += n;
        if (n < DELETE_BATCH) break;
      }
    }

    const deliveryCutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS);
    const { count: deliveriesDeleted } = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: deliveryCutoff }, status: { not: 'pending' } },
    });

    const dropped = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT drop_old_event_partitions(${maxDays}::integer) AS n`;
    return { eventsDeleted, deliveriesDeleted, visitorsDeleted, partitionsDropped: Number(dropped[0]?.n ?? 0) };
  }
}
