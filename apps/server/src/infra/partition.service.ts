import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

const DAY_MS = 24 * 60 * 60_000;
const MONTHS_AHEAD = 2;

/** Keeps monthly events partitions created ahead of time. Retention drops come in Phase 2. */
@Injectable()
export class PartitionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Partitions');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure();
    this.timer = setInterval(() => void this.ensure(), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async ensure(): Promise<void> {
    try {
      await this.prisma.$executeRaw`SELECT ensure_event_partitions(${MONTHS_AHEAD}::integer)`;
    } catch (err) {
      this.logger.error(`ensure_event_partitions failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}
