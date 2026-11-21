import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { describeError } from '../common/log-safe.js';
import { ENV, type Env } from '../config/env.js';
import { FraudService } from '../fraud/fraud.service.js';
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

/** Postgres 23503: Prisma reports raw-query failures as P2010 with the database code in meta.code. */
function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { meta?: { code?: unknown }; message?: unknown } | null;
  return e?.meta?.code === '23503' || (typeof e?.message === 'string' && e.message.includes('23503'));
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
    private readonly fraud: FraudService,
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
      const stats = await this.refreshComponentStats();
      this.logger.log(`component stats: projects=${stats.projects} rows=${stats.rows}`);
      const nonces = await this.prisma.requestNonce.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
      this.logger.log(`request nonces purged: ${nonces.count}`);
      const ipUsage = await this.prisma.ipProviderUsage.deleteMany({ where: { day: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
      this.logger.log(`ip provider usage purged: ${ipUsage.count}`);
      const alertHistory = await this.prisma.alertEvent.deleteMany({ where: { firedAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
      this.logger.log(`alert history purged: ${alertHistory.count}`);
      const fraud = await this.fraud.trainStale();
      this.logger.log(`fraud models: trained=${fraud.trained}`);
    } catch (err) {
      this.logger.error(`maintenance failed: ${describeError(err)}`);
    }
  }

  /**
   * Partition DDL locks events and, through the foreign key, visitors: the reverse of the
   * order ingest uses. lock_timeout below Postgres's 1 s deadlock check makes the DDL give
   * up first, so ingest never becomes the deadlock victim; the DDL retries on the next run.
   */
  private async ddl<T>(run: () => Prisma.PrismaPromise<T>): Promise<T> {
    const [, result] = await this.prisma.$transaction([
      this.prisma.$executeRaw`SET LOCAL lock_timeout = '500ms'`,
      run(),
    ]);
    return result;
  }

  /** Batch deletes may outlast the request-path statement timeout; give each its own budget. */
  private async slow(run: () => Prisma.PrismaPromise<number>): Promise<number> {
    const [, n] = await this.prisma.$transaction([this.prisma.$executeRaw`SET LOCAL statement_timeout = '120s'`, run()]);
    return n;
  }

  async ensurePartitions(): Promise<void> {
    try {
      await this.ddl(() => this.prisma.$executeRaw`SELECT ensure_event_partitions(${MONTHS_AHEAD}::integer)`);
    } catch (err) {
      this.logger.error(`ensure_event_partitions failed: ${describeError(err)}`);
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

  /**
   * Rebuilds the value frequencies the linkage matcher uses, one project per transaction, from each visitor's latest
   * components. Public so tests and operators can run it on demand.
   */
  async refreshComponentStats(): Promise<{ projects: number; rows: number }> {
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    let rows = 0;
    for (const { id } of projects) {
      let counts: number[];
      try {
        counts = await this.prisma.$transaction([
          this.prisma.$executeRaw`SET LOCAL statement_timeout = '120s'`,
          this.prisma.$executeRaw`DELETE FROM "component_stats" WHERE "projectId" = ${id}::uuid`,
          this.prisma.$executeRaw`
            INSERT INTO "component_stats" ("projectId", "component", "value", "visitors")
            SELECT ${id}::uuid, e.key, e.value, count(*)::int
            FROM "visitors" v, jsonb_each_text(v."signalSummary") e
            WHERE v."projectId" = ${id}::uuid AND length(e.key) <= 24 AND length(e.value) <= 64
            GROUP BY e.key, e.value
            HAVING count(*) >= 2`,
          this.prisma.$executeRaw`
            INSERT INTO "component_stats" ("projectId", "component", "value", "visitors")
            SELECT ${id}::uuid, '_total', '_', count(*)::int FROM "visitors" WHERE "projectId" = ${id}::uuid`,
        ]);
      } catch (err) {
        // The project was deleted while the job ran (foreign key violation): nothing to keep for it.
        if (isForeignKeyViolation(err)) continue;
        throw err;
      }
      rows += (counts[2] ?? 0) + (counts[3] ?? 0);
    }
    return { projects: projects.length, rows };
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
        const n = await this.slow(() => this.prisma.$executeRaw`
          DELETE FROM "events" WHERE ("id", "createdAt") IN (
            SELECT "id", "createdAt" FROM "events"
            WHERE "projectId" = ${project.id}::uuid AND "createdAt" < ${cutoff}
            LIMIT ${DELETE_BATCH}
          )`);
        eventsDeleted += n;
        if (n < DELETE_BATCH) break;
      }
      for (;;) {
        const n = await this.slow(() => this.prisma.$executeRaw`
          DELETE FROM "visitors" WHERE "id" IN (
            SELECT "id" FROM "visitors"
            WHERE "projectId" = ${project.id}::uuid AND "lastSeenAt" < ${cutoff}
            LIMIT ${DELETE_BATCH}
          )`);
        visitorsDeleted += n;
        if (n < DELETE_BATCH) break;
      }
      // Rows of visitors that are still active but for networks or accounts not seen within retention.
      await this.slow(
        () => this.prisma.$executeRaw`
          DELETE FROM "device_profiles" WHERE "projectId" = ${project.id}::uuid AND "lastSeenAt" < ${cutoff}`,
      );
      await this.slow(
        () => this.prisma.$executeRaw`
          DELETE FROM "visitor_accounts" WHERE "projectId" = ${project.id}::uuid AND "lastSeenAt" < ${cutoff}`,
      );
    }

    const deliveryCutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS);
    const { count: deliveriesDeleted } = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: deliveryCutoff }, status: { not: 'pending' } },
    });

    let partitionsDropped = 0;
    try {
      const dropped = await this.ddl(
        () => this.prisma.$queryRaw<{ n: number }[]>`SELECT drop_old_event_partitions(${maxDays}::integer) AS n`,
      );
      partitionsDropped = Number(dropped[0]?.n ?? 0);
    } catch (err) {
      this.logger.warn(`partition drop deferred: ${describeError(err).slice(0, 200)}`);
    }
    return { eventsDeleted, deliveriesDeleted, visitorsDeleted, partitionsDropped };
  }
}
