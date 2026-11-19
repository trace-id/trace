import { describe, expect, it } from 'vitest';
import { InvestigateService } from './investigate.service.js';
import { type PrismaService } from '../infra/prisma.service.js';

interface Row {
  visitorId: string;
  deviceId: string | null;
  ip: string | null;
  linkedId: string | null;
  events: number;
  maxScore: number;
  lastAt: Date;
}

const t = new Date('2026-01-01T00:00:00Z');
const row = (visitorId: string, ip: string | null, linkedId: string | null, maxScore = 10, deviceId: string | null = null): Row => ({
  visitorId, deviceId: deviceId ?? visitorId, ip, linkedId, events: 2, maxScore, lastAt: t,
});

function service(rows: Row[]): InvestigateService {
  const prisma = { $queryRaw: async () => rows } as unknown as PrismaService;
  return new InvestigateService(prisma);
}

describe('InvestigateService.rings', () => {
  it('joins devices that share an IP or an account, transitively, and ranks by risk', async () => {
    const rows = [
      row('A', '1.1.1.1', 'acc1', 90),
      row('B', '1.1.1.1', 'acc2', 80), // shares the IP with A
      row('C', '9.9.9.9', 'acc2', 70), // shares acc2 with B, so C joins A and B through B
      row('D', '5.5.5.5', 'solo', 5), // alone
      row('E', '6.6.6.6', 'solo2', 5),
    ];
    const r = await service(rows).rings('p', 30, 2);
    expect(r.rings).toHaveLength(1);
    const ring = r.rings[0]!;
    expect(ring.size).toBe(3);
    expect(ring.sharedIps).toEqual(['1.1.1.1']);
    expect(ring.sharedAccounts).toEqual(['acc2']);
    expect(ring.maxScore).toBe(90);
    expect(ring.risk).toBeGreaterThan(40);
  });

  it('does not link devices just because they are both on a private single-use IP', async () => {
    const r = await service([row('A', '1.1.1.1', 'a'), row('B', '2.2.2.2', 'b')]).rings('p', 30, 2);
    expect(r.rings).toEqual([]);
  });

  it('treats browsers of one device as one group even without a shared IP or account', async () => {
    const r = await service([row('A', '1.1.1.1', 'a', 10, 'A'), row('B', '2.2.2.2', 'b', 10, 'A')]).rings('p', 30, 2);
    expect(r.rings).toHaveLength(1);
    expect(r.rings[0]!.size).toBe(2);
  });

  it('respects the minimum size and reports truncation', async () => {
    const rows = [row('A', '1.1.1.1', 'x'), row('B', '1.1.1.1', 'y')];
    expect((await service(rows).rings('p', 30, 3)).rings).toEqual([]);
    expect((await service(rows).rings('p', 30, 2)).truncated).toBe(false);
  });
});

describe('InvestigateService.graph', () => {
  it('builds typed nodes and weighted edges around the seed', async () => {
    const rows = [row('A', '1.1.1.1', 'acc1', 90), row('B', '1.1.1.1', 'acc1', 20)];
    const g = await service(rows).graph('p', { type: 'account', id: 'acc1' }, 30);
    expect(g.seed).toBe('a:acc1');
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a:acc1', 'i:1.1.1.1', 'v:A', 'v:B']);
    expect(g.nodes.find((n) => n.id === 'a:acc1')!.score).toBe(90);
    expect(g.edges).toHaveLength(4);
    expect(g.edges.every((e) => e.weight === 2)).toBe(true);
    expect(g.truncated).toBe(false);
  });
});
