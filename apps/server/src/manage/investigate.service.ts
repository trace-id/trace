import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type GraphResponse, type PolicySimulation, type QualityResponse, type RingsResponse } from '@trace-id/signals/api';
import { PrismaService } from '../infra/prisma.service.js';

const DAY_MS = 24 * 60 * 60_000;
const MAX_TUPLES = 60_000;
const MAX_GRAPH_NODES = 160;

interface Tuple {
  visitorId: string;
  deviceId: string | null;
  ip: string | null;
  linkedId: string | null;
  events: number;
  maxScore: number;
  lastAt: Date;
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    for (let p = this.parent.get(root); p !== undefined && p !== root; p = this.parent.get(root)) root = p;
    if (!this.parent.has(root)) this.parent.set(root, root);
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface SimRule {
  minScore?: number;
  signals?: string[];
  countries?: string[];
  notCountries?: string[];
  matchKind?: string;
}

/**
 * Investigation tools: fraud rings (connected groups of devices sharing IPs or accounts), a relationship graph around one
 * entity, policy what-if simulation, and data-quality statistics. Every query is project scoped and window bounded.
 */
@Injectable()
export class InvestigateService {
  constructor(private readonly prisma: PrismaService) {}

  private tuples(projectId: string, from: Date, extra: Prisma.Sql = Prisma.empty): Promise<Tuple[]> {
    return this.prisma.$queryRaw<Tuple[]>`
      SELECT e."visitorId", v."deviceId", e."ip", e."linkedId", count(*)::int AS events,
             max(e."suspectScore")::int AS "maxScore", max(e."createdAt") AS "lastAt"
      FROM "events" e JOIN "visitors" v ON v."id" = e."visitorId"
      WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} ${extra}
      GROUP BY e."visitorId", v."deviceId", e."ip", e."linkedId"
      LIMIT ${MAX_TUPLES}`;
  }

  /** Groups of visitors tied together by a shared IP or account (or by being browsers of one device). */
  async rings(projectId: string, days: number, minVisitors: number): Promise<RingsResponse> {
    const from = new Date(Date.now() - days * DAY_MS);
    const rows = await this.tuples(projectId, from);
    const uf = new UnionFind();
    // An IP or account only links visitors if more than one visitor used it.
    const ipVisitors = new Map<string, Set<string>>();
    const accVisitors = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.ip) (ipVisitors.get(r.ip) ?? ipVisitors.set(r.ip, new Set()).get(r.ip)!).add(r.visitorId);
      if (r.linkedId) (accVisitors.get(r.linkedId) ?? accVisitors.set(r.linkedId, new Set()).get(r.linkedId)!).add(r.visitorId);
      if (r.deviceId && r.deviceId !== r.visitorId) uf.union(`v:${r.visitorId}`, `v:${r.deviceId}`);
    }
    for (const set of ipVisitors.values()) if (set.size > 1) [...set].reduce((a, b) => (uf.union(`v:${a}`, `v:${b}`), b));
    for (const set of accVisitors.values()) if (set.size > 1) [...set].reduce((a, b) => (uf.union(`v:${a}`, `v:${b}`), b));

    interface Agg { visitors: Set<string>; accounts: Set<string>; ips: Set<string>; events: number; maxScore: number; scoreSum: number; lastAt: Date; sharedIps: Set<string>; sharedAccounts: Set<string> }
    const comps = new Map<string, Agg>();
    for (const r of rows) {
      const root = uf.find(`v:${r.visitorId}`);
      const c = comps.get(root) ?? { visitors: new Set(), accounts: new Set(), ips: new Set(), events: 0, maxScore: 0, scoreSum: 0, lastAt: r.lastAt, sharedIps: new Set(), sharedAccounts: new Set() };
      c.visitors.add(r.visitorId);
      if (r.linkedId) {
        c.accounts.add(r.linkedId);
        if ((accVisitors.get(r.linkedId)?.size ?? 0) > 1) c.sharedAccounts.add(r.linkedId);
      }
      if (r.ip) {
        c.ips.add(r.ip);
        if ((ipVisitors.get(r.ip)?.size ?? 0) > 1) c.sharedIps.add(r.ip);
      }
      c.events += r.events;
      c.maxScore = Math.max(c.maxScore, r.maxScore);
      c.scoreSum += r.maxScore;
      if (r.lastAt > c.lastAt) c.lastAt = r.lastAt;
      comps.set(root, c);
    }
    const rings = [...comps.entries()]
      .filter(([, c]) => c.visitors.size >= minVisitors)
      .map(([root, c]) => {
        const visitors = [...c.visitors].sort();
        // Risk: bigger rings with higher scores and more shared infrastructure rank first.
        const risk = Math.min(100, Math.round((c.scoreSum / c.visitors.size) * 0.6 + Math.min(40, c.visitors.size * 3 + c.sharedIps.size * 4 + c.sharedAccounts.size * 3)));
        return {
          id: root.slice(2),
          size: c.visitors.size,
          accounts: c.accounts.size,
          ips: c.ips.size,
          events: c.events,
          maxScore: c.maxScore,
          avgPeakScore: Math.round(c.scoreSum / c.visitors.size),
          risk,
          sharedIps: [...c.sharedIps].slice(0, 5),
          sharedAccounts: [...c.sharedAccounts].slice(0, 5),
          sampleVisitors: visitors.slice(0, 5),
          lastSeenAt: c.lastAt.toISOString(),
        };
      })
      .sort((a, b) => b.risk - a.risk || b.size - a.size)
      .slice(0, 50);
    return { days, truncated: rows.length >= MAX_TUPLES, rings };
  }

  /** Neighbourhood of one entity: visitors, accounts and IPs connected to it within two hops. */
  async graph(projectId: string, seed: { type: 'visitor' | 'account' | 'ip'; id: string }, days: number): Promise<GraphResponse> {
    const from = new Date(Date.now() - days * DAY_MS);
    const col = { visitor: Prisma.sql`e."visitorId"`, account: Prisma.sql`e."linkedId"`, ip: Prisma.sql`e."ip"` }[seed.type];
    let rows = await this.tuples(projectId, from, Prisma.sql`AND ${col} = ${seed.id}`);
    for (let hop = 0; hop < 2; hop++) {
      const visitors = [...new Set(rows.map((r) => r.visitorId))].slice(0, 40);
      const accounts = [...new Set(rows.map((r) => r.linkedId).filter((x): x is string => !!x))].slice(0, 40);
      const ips = [...new Set(rows.map((r) => r.ip).filter((x): x is string => !!x))].slice(0, 40);
      const more = await this.tuples(
        projectId,
        from,
        Prisma.sql`AND (e."visitorId" IN (${Prisma.join(visitors.length ? visitors : [''])}) OR e."linkedId" IN (${Prisma.join(accounts.length ? accounts : [''])}) OR e."ip" IN (${Prisma.join(ips.length ? ips : [''])}))`,
      );
      rows = more;
      if (more.length > 1500) break;
    }
    const nodes = new Map<string, GraphResponse['nodes'][number]>();
    const edges = new Map<string, GraphResponse['edges'][number]>();
    const addNode = (key: string, type: 'visitor' | 'account' | 'ip', label: string, score: number, events: number) => {
      const n = nodes.get(key);
      if (n) {
        n.score = Math.max(n.score, score);
        n.events += events;
      } else nodes.set(key, { id: key, type, label, score, events });
    };
    const addEdge = (a: string, b: string, weight: number) => {
      const k = `${a}|${b}`;
      const e = edges.get(k);
      if (e) e.weight += weight;
      else edges.set(k, { source: a, target: b, weight });
    };
    for (const r of rows) {
      addNode(`v:${r.visitorId}`, 'visitor', r.visitorId, r.maxScore, r.events);
      if (r.linkedId) {
        addNode(`a:${r.linkedId}`, 'account', r.linkedId, r.maxScore, r.events);
        addEdge(`v:${r.visitorId}`, `a:${r.linkedId}`, r.events);
      }
      if (r.ip) {
        addNode(`i:${r.ip}`, 'ip', r.ip, r.maxScore, r.events);
        addEdge(`v:${r.visitorId}`, `i:${r.ip}`, r.events);
      }
    }
    const seedKey = `${seed.type === 'visitor' ? 'v' : seed.type === 'account' ? 'a' : 'i'}:${seed.id}`;
    let list = [...nodes.values()];
    const truncated = list.length > MAX_GRAPH_NODES;
    if (truncated) {
      const keep = new Set(list.sort((a, b) => (a.id === seedKey ? -1 : b.id === seedKey ? 1 : b.events - a.events)).slice(0, MAX_GRAPH_NODES).map((n) => n.id));
      list = list.filter((n) => keep.has(n.id));
    }
    const keepSet = new Set(list.map((n) => n.id));
    return { seed: seedKey, truncated, nodes: list, edges: [...edges.values()].filter((e) => keepSet.has(e.source) && keepSet.has(e.target)) };
  }

  /** What a policy would have caught over the window, so thresholds are chosen from your own traffic (shadow mode). */
  async simulate(projectId: string, days: number, rule: SimRule): Promise<PolicySimulation> {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const conds: Prisma.Sql[] = [];
    if (rule.minScore !== undefined) conds.push(Prisma.sql`e."suspectScore" >= ${rule.minScore}`);
    if (rule.signals?.length) {
      conds.push(Prisma.sql`(${Prisma.join(rule.signals.map((s) => Prisma.sql`(e."signals"->'results'->${s}->>'detected') = 'true'`), ' OR ')})`);
    }
    if (rule.countries?.length) conds.push(Prisma.sql`e."country" IN (${Prisma.join(rule.countries)})`);
    if (rule.notCountries?.length) conds.push(Prisma.sql`(e."country" IS NULL OR e."country" NOT IN (${Prisma.join(rule.notCountries)}))`);
    if (rule.matchKind) conds.push(Prisma.sql`e."matchKind" = ${rule.matchKind}`);
    const where = conds.length ? Prisma.sql`AND ${Prisma.join(conds, ' AND ')}` : Prisma.sql`AND false`;

    const [tot, matched, byDay, bands, linked] = await Promise.all([
      this.prisma.$queryRaw<{ events: number; visitors: number }[]>`
        SELECT count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from}`,
      this.prisma.$queryRaw<{ events: number; visitors: number; accounts: number }[]>`
        SELECT count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors, count(DISTINCT e."linkedId")::int AS accounts FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} ${where}`,
      this.prisma.$queryRaw<{ d: string; n: number }[]>`
        SELECT to_char(date_trunc('day', e."createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, count(*)::int AS n FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} ${where} GROUP BY 1`,
      this.prisma.$queryRaw<{ b: number; n: number }[]>`
        SELECT least(e."suspectScore" / 10, 9)::int AS b, count(*)::int AS n FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} ${where} GROUP BY 1`,
      // Accounts the rule would hit most often: where a blocking policy would be felt first.
      this.prisma.$queryRaw<{ linkedId: string; hits: number }[]>`
        SELECT e."linkedId" AS "linkedId", count(*)::int AS hits
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."linkedId" IS NOT NULL ${where}
        GROUP BY 1 ORDER BY hits DESC LIMIT 8`,
    ]);
    const dayMap = new Map(byDay.map((r) => [r.d, r.n]));
    const series: { t: string; matched: number }[] = [];
    for (let t = new Date(from.toISOString().slice(0, 10) + 'T00:00:00Z').getTime(); t <= to.getTime(); t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      series.push({ t: key, matched: dayMap.get(key) ?? 0 });
    }
    const events = tot[0]?.events ?? 0;
    const m = matched[0];
    return {
      days,
      totalEvents: events,
      totalVisitors: tot[0]?.visitors ?? 0,
      matchedEvents: m?.events ?? 0,
      matchedVisitors: m?.visitors ?? 0,
      matchedAccounts: m?.accounts ?? 0,
      matchRate: events ? (m?.events ?? 0) / events : 0,
      series,
      scoreBands: Array.from({ length: 10 }, (_, i) => bands.find((b) => b.b === i)?.n ?? 0),
      topAccounts: linked.map((l) => ({ linkedId: l.linkedId, hits: l.hits })),
    };
  }

  async quality(projectId: string, days: number): Promise<QualityResponse> {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const [core, pct, comps, conf] = await Promise.all([
      this.prisma.$queryRaw<
        { events: number; withAccount: number; withTags: number; withIp: number; withCountry: number; newKind: number; token: number; match: number; conflict: number }[]
      >`
        SELECT count(*)::int AS events,
               (count(*) FILTER (WHERE e."linkedId" IS NOT NULL))::int AS "withAccount",
               (count(*) FILTER (WHERE e."tags" IS NOT NULL))::int AS "withTags",
               (count(*) FILTER (WHERE e."ip" IS NOT NULL))::int AS "withIp",
               (count(*) FILTER (WHERE e."country" IS NOT NULL))::int AS "withCountry",
               (count(*) FILTER (WHERE e."matchKind" = 'new'))::int AS "newKind",
               (count(*) FILTER (WHERE e."matchKind" = 'token'))::int AS token,
               (count(*) FILTER (WHERE e."matchKind" = 'match'))::int AS match,
               (count(*) FILTER (WHERE e."matchKind" = 'conflict'))::int AS conflict
        FROM "events" e WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from}`,
      this.prisma.$queryRaw<{ p50: number | null; p95: number | null; p99: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (e."signals"->>'collectMs')::float) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (e."signals"->>'collectMs')::float) AS p95,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY (e."signals"->>'collectMs')::float) AS p99
        FROM "events" e WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."signals" ? 'collectMs'`,
      this.prisma.$queryRaw<{ k: string; n: number }[]>`
        SELECT c.k AS k, count(*)::int AS n
        FROM "events" e, LATERAL jsonb_object_keys(coalesce(e."signals"->'components', '{}'::jsonb)) AS c(k)
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from}
        GROUP BY 1 ORDER BY n DESC`,
      this.prisma.$queryRaw<{ b: number; n: number }[]>`
        SELECT least(floor(e."confidence" * 10), 9)::int AS b, count(*)::int AS n
        FROM "events" e WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."matchKind" <> 'new'
        GROUP BY 1`,
    ]);
    const c = core[0];
    const n = c?.events ?? 0;
    const share = (x: number | undefined) => (n ? (x ?? 0) / n : 0);
    return {
      days,
      events: n,
      collectMs: { p50: pct[0]?.p50 ?? null, p95: pct[0]?.p95 ?? null, p99: pct[0]?.p99 ?? null },
      coverage: {
        linkedId: share(c?.withAccount),
        tags: share(c?.withTags),
        ip: share(c?.withIp),
        country: share(c?.withCountry),
      },
      identification: { new: share(c?.newKind), token: share(c?.token), match: share(c?.match), conflict: share(c?.conflict) },
      components: comps.map((x) => ({ name: x.k, share: n ? x.n / n : 0 })),
      confidenceBuckets: Array.from({ length: 10 }, (_, i) => conf.find((b) => b.b === i)?.n ?? 0),
    };
  }
}
