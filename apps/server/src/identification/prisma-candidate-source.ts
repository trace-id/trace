import { type Components } from '@tbdname/signals/types';
import { type PrismaService } from '../infra/prisma.service.js';
import { type CandidateSource, type VisitorSnapshot } from './engine.js';

function toSnapshot(row: { id: string; signalSummary: unknown; lastSeenAt: Date }): VisitorSnapshot {
  const summary = row.signalSummary;
  const components = (summary && typeof summary === 'object' ? summary : {}) as Components;
  return { id: row.id, components, lastSeenAt: row.lastSeenAt };
}

/** Every query is scoped by projectId, so one project can never match another's visitors. */
export class PrismaCandidateSource implements CandidateSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectId: string,
  ) {}

  async byBuckets(bucketHashes: string[], limit: number): Promise<VisitorSnapshot[]> {
    const rows = await this.prisma.visitorBucket.findMany({
      where: { projectId: this.projectId, bucketHash: { in: bucketHashes } },
      select: { visitorId: true },
      orderBy: { visitorId: 'asc' },
      take: limit * bucketHashes.length,
    });
    const ids = [...new Set(rows.map((r) => r.visitorId))].slice(0, limit);
    if (ids.length === 0) return [];
    const visitors = await this.prisma.visitor.findMany({
      where: { projectId: this.projectId, id: { in: ids } },
      select: { id: true, signalSummary: true, lastSeenAt: true },
    });
    return visitors.map(toSnapshot);
  }

  async byId(visitorId: string): Promise<VisitorSnapshot | null> {
    const row = await this.prisma.visitor.findFirst({
      where: { id: visitorId, projectId: this.projectId },
      select: { id: true, signalSummary: true, lastSeenAt: true },
    });
    return row ? toSnapshot(row) : null;
  }
}
