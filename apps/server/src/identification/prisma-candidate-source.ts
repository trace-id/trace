import { type FrequencyTable } from '@trace-id/signals/linkage';
import { type ComponentName, type Components } from '@trace-id/signals/types';
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

  /** One query: the counts for this payload's values plus the project total. */
  async frequencies(components: Components): Promise<FrequencyTable> {
    const pairs = Object.entries(components).filter((e): e is [string, string] => typeof e[1] === 'string');
    const rows = await this.prisma.componentStat.findMany({
      where: {
        projectId: this.projectId,
        OR: [{ component: '_total', value: '_' }, ...pairs.map(([component, value]) => ({ component, value }))],
      },
      select: { component: true, value: true, visitors: true },
    });
    const counts = new Map(rows.map((r) => [`${r.component}:${r.value}`, r.visitors]));
    return {
      total: counts.get('_total:_') ?? 0,
      count: (component: ComponentName, value: string) => counts.get(`${component}:${value}`) ?? 0,
    };
  }

  async byId(visitorId: string): Promise<VisitorSnapshot | null> {
    const row = await this.prisma.visitor.findFirst({
      where: { id: visitorId, projectId: this.projectId },
      select: { id: true, signalSummary: true, lastSeenAt: true },
    });
    return row ? toSnapshot(row) : null;
  }
}
