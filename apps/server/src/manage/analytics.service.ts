import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AnalyticsResponse,
  type ClientsResponse,
  type AnalyticsTotals,
  type CountRow,
  type LinkedIdListResponse,
  type VisitorListResponse,
} from '@trace-id/signals/api';
import { SIGNAL_IDS } from '@trace-id/signals/config';
import { uaLabels } from './ua-labels.js';
import { PrismaService } from '../infra/prisma.service.js';

const SUSPICIOUS = 70;
const DAY_MS = 24 * 60 * 60_000;
/** Signals that mean "not an ordinary person on an ordinary browser" for the automated-traffic tile. */
const AUTOMATED = ['bot', 'tor', 'vpn', 'proxy', 'tampering', 'antiDetect', 'automatedInput', 'aiAgent', 'emulator'] as const;

function detected(id: string): Prisma.Sql {
  // id comes from the SIGNAL_IDS constant, never from a request.
  return Prisma.sql`(e."signals"->'results'->${id}->>'detected') = 'true'`;
}

const automatedSql = Prisma.join(AUTOMATED.map((id) => detected(id)), ' OR ');

type TotalsRow = {
  events: number; visitors: number; newVisitors: number; suspicious: number; automated: number;
  avgScore: number | null; avgConfidence: number | null; uniqueIps: number; uniqueLinkedIds: number;
};

function toTotals(r: TotalsRow | undefined): AnalyticsTotals {
  return {
    events: r?.events ?? 0,
    visitors: r?.visitors ?? 0,
    newVisitors: r?.newVisitors ?? 0,
    returningVisitors: Math.max(0, (r?.visitors ?? 0) - (r?.newVisitors ?? 0)),
    suspicious: r?.suspicious ?? 0,
    automated: r?.automated ?? 0,
    avgScore: Math.round((r?.avgScore ?? 0) * 10) / 10,
    avgConfidence: Math.round((r?.avgConfidence ?? 0) * 1000) / 1000,
    uniqueIps: r?.uniqueIps ?? 0,
    uniqueLinkedIds: r?.uniqueLinkedIds ?? 0,
  };
}

/** Read-only aggregates for the dashboard. Every query is scoped to one project and a bounded window. */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private totals(projectId: string, from: Date, to: Date): Promise<TotalsRow[]> {
    return this.prisma.$queryRaw<TotalsRow[]>`
      SELECT count(*)::int AS events,
             count(DISTINCT e."visitorId")::int AS visitors,
             (count(*) FILTER (WHERE e."matchKind" = 'new'))::int AS "newVisitors",
             (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious,
             (count(*) FILTER (WHERE ${automatedSql}))::int AS automated,
             avg(e."suspectScore")::float AS "avgScore",
             avg(e."confidence")::float AS "avgConfidence",
             count(DISTINCT e."ip")::int AS "uniqueIps",
             count(DISTINCT e."linkedId")::int AS "uniqueLinkedIds"
      FROM "events" e
      WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}`;
  }

  private async countRows(rows: { key: string | null; events: number; visitors: number; suspicious: number }[]): Promise<CountRow[]> {
    return rows.filter((r) => r.key !== null && r.key !== '').map((r) => ({ key: String(r.key), events: r.events, visitors: r.visitors, suspicious: r.suspicious }));
  }

  /** Events per client package and version in the window, newest activity included. */
  async clients(projectId: string, days: number): Promise<ClientsResponse> {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      { name: string | null; version: string | null; engineName: string | null; engineVersion: string | null; events: number; visitors: number; suspicious: number; firstSeen: Date; lastSeen: Date }[]
    >`
      SELECT COALESCE(e."signals"->'via'->>'name', e."signals"->'sdk'->>'name') AS name,
             COALESCE(e."signals"->'via'->>'version', e."signals"->'sdk'->>'version') AS version,
             e."signals"->'sdk'->>'name' AS "engineName",
             e."signals"->'sdk'->>'version' AS "engineVersion",
             count(*)::int AS events,
             count(DISTINCT e."visitorId")::int AS visitors,
             (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious,
             min(e."createdAt") AS "firstSeen",
             max(e."createdAt") AS "lastSeen"
      FROM "events" e
      WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
      GROUP BY 1, 2, 3, 4
      ORDER BY events DESC
      LIMIT 50`;
    return {
      clients: rows
        .filter((r) => r.name)
        .map((r) => ({
          name: r.name as string,
          version: r.version ?? '',
          engine: { name: r.engineName ?? (r.name as string), version: r.engineVersion ?? r.version ?? '' },
          events: r.events,
          visitors: r.visitors,
          suspicious: r.suspicious,
          firstSeen: r.firstSeen.toISOString(),
          lastSeen: r.lastSeen.toISOString(),
        })),
    };
  }

  async overview(projectId: string, days: number): Promise<AnalyticsResponse> {
    const to = new Date();
    const hourly = days <= 2;
    const from = new Date(to.getTime() - days * DAY_MS);
    const prevFrom = new Date(from.getTime() - days * DAY_MS);
    const trunc = hourly ? 'hour' : 'day';
    const fmt = hourly ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD';

    const signalCols = Prisma.join(
      SIGNAL_IDS.map(
        (id) =>
          Prisma.sql`(count(*) FILTER (WHERE ${detected(id)}))::int AS ${Prisma.raw(`"e_${id}"`)},
                     (count(DISTINCT e."visitorId") FILTER (WHERE ${detected(id)}))::int AS ${Prisma.raw(`"v_${id}"`)}`,
      ),
    );

    const [cur, prev, series, hist, kinds, sig, countries, asns, uas, ips, linked, heat, sdks] = await Promise.all([
      this.totals(projectId, from, to),
      this.totals(projectId, prevFrom, from),
      this.prisma.$queryRaw<{ t: string; events: number; visitors: number; newVisitors: number; suspicious: number }[]>`
        SELECT to_char(date_trunc(${Prisma.raw(`'${trunc}'`)}, e."createdAt" AT TIME ZONE 'UTC'), ${Prisma.raw(`'${fmt}'`)}) AS t,
               count(*)::int AS events,
               count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."matchKind" = 'new'))::int AS "newVisitors",
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ b: number; n: number }[]>`
        SELECT least(e."suspectScore" / 10, 9)::int AS b, count(*)::int AS n
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ k: string; n: number }[]>`
        SELECT e."matchKind" AS k, count(*)::int AS n
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT ${signalCols}
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}`,
      this.prisma.$queryRaw<{ key: string | null; events: number; visitors: number; suspicious: number }[]>`
        SELECT e."country" AS key, count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 ORDER BY events DESC LIMIT 25`,
      this.prisma.$queryRaw<{ key: string | null; events: number; visitors: number; suspicious: number }[]>`
        SELECT e."asn"::text AS key, count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to} AND e."asn" IS NOT NULL
        GROUP BY 1 ORDER BY events DESC LIMIT 15`,
      this.prisma.$queryRaw<{ ua: string | null; events: number; visitors: number; suspicious: number }[]>`
        SELECT e."signals"->'attributes'->>'userAgent' AS ua, count(*)::int AS events,
               count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 ORDER BY events DESC LIMIT 400`,
      this.prisma.$queryRaw<{ key: string | null; events: number; visitors: number; suspicious: number }[]>`
        SELECT e."ip" AS key, count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to} AND e."ip" IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC, events DESC LIMIT 10`,
      this.prisma.$queryRaw<{ key: string | null; events: number; visitors: number; suspicious: number }[]>`
        SELECT e."linkedId" AS key, count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors,
               (count(*) FILTER (WHERE e."suspectScore" >= ${SUSPICIOUS}))::int AS suspicious
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to} AND e."linkedId" IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC, events DESC LIMIT 10`,
      this.prisma.$queryRaw<{ d: number; h: number; n: number }[]>`
        SELECT extract(dow FROM e."createdAt" AT TIME ZONE 'UTC')::int AS d,
               extract(hour FROM e."createdAt" AT TIME ZONE 'UTC')::int AS h, count(*)::int AS n
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ key: string | null; events: number }[]>`
        SELECT COALESCE(e."signals"->'via'->>'name', e."signals"->'sdk'->>'name') || ' ' || COALESCE(e."signals"->'via'->>'version', e."signals"->'sdk'->>'version') AS key, count(*)::int AS events
        FROM "events" e
        WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 ORDER BY events DESC LIMIT 8`,
    ]);

    // Fill gaps so charts have a point per bucket.
    const bucketMs = hourly ? 60 * 60_000 : DAY_MS;
    const start = hourly ? new Date(Math.floor(from.getTime() / bucketMs) * bucketMs) : new Date(new Date(from.toISOString().slice(0, 10) + 'T00:00:00Z'));
    const byT = new Map(series.map((r) => [r.t, r]));
    const points: AnalyticsResponse['series'] = [];
    for (let t = start.getTime(); t <= to.getTime(); t += bucketMs) {
      const iso = new Date(t).toISOString();
      const key = hourly ? iso.slice(0, 13) : iso.slice(0, 10);
      const r = byT.get(key);
      points.push({ t: key, events: r?.events ?? 0, visitors: r?.visitors ?? 0, newVisitors: r?.newVisitors ?? 0, suspicious: r?.suspicious ?? 0 });
    }

    const scoreHistogram = Array.from({ length: 10 }, (_, i) => hist.find((h) => h.b === i)?.n ?? 0);
    const sigRow = sig[0] ?? {};
    const signals = SIGNAL_IDS.map((id) => ({ id: id as string, events: Number(sigRow[`e_${id}`] ?? 0), visitors: Number(sigRow[`v_${id}`] ?? 0) }))
      .filter((s) => s.events > 0)
      .sort((a, b) => b.events - a.events);

    const group = (pick: (ua: string) => string): CountRow[] => {
      const map = new Map<string, CountRow>();
      for (const r of uas) {
        const key = r.ua ? pick(r.ua) : 'Unknown';
        const row = map.get(key) ?? { key, events: 0, visitors: 0, suspicious: 0 };
        row.events += r.events;
        row.visitors += r.visitors; // an upper bound across UA strings; exact counts need a per-visitor pass
        row.suspicious += r.suspicious;
        map.set(key, row);
      }
      return [...map.values()].sort((a, b) => b.events - a.events).slice(0, 10);
    };

    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const h of heat) (heatmap[h.d] as number[])[h.h] = h.n;

    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      suspiciousThreshold: SUSPICIOUS,
      totals: toTotals(cur[0]),
      previous: toTotals(prev[0]),
      series: points,
      scoreHistogram,
      matchKinds: Object.fromEntries(kinds.map((k) => [k.k, k.n])),
      signals,
      countries: await this.countRows(countries),
      asns: await this.countRows(asns),
      browsers: group((ua) => uaLabels(ua).browser),
      os: group((ua) => uaLabels(ua).os),
      deviceTypes: group((ua) => uaLabels(ua).deviceType),
      topIps: await this.countRows(ips),
      topLinkedIds: await this.countRows(linked),
      heatmap,
      sdks: sdks.filter((s) => s.key).map((s) => ({ key: s.key as string, events: s.events })),
    };
  }

  /** Visitors with their latest event's context. Keyset-free (offset in the cursor): bounded by `limit` and a max offset. */
  async visitors(
    projectId: string,
    opts: { limit: number; offset: number; sort: 'recent' | 'events' | 'risk' | 'new'; minScore?: number; q?: string },
  ): Promise<VisitorListResponse> {
    const order = {
      recent: Prisma.sql`v."lastSeenAt" DESC`,
      events: Prisma.sql`v."eventCount" DESC, v."lastSeenAt" DESC`,
      risk: Prisma.sql`"maxScore" DESC, v."lastSeenAt" DESC`,
      new: Prisma.sql`v."firstSeenAt" DESC`,
    }[opts.sort];
    const like = opts.q ? `${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.prisma.$queryRaw<
      {
        id: string; deviceId: string | null; firstSeenAt: Date; lastSeenAt: Date; eventCount: number; maxScore: number;
        lastScore: number; country: string | null; ip: string | null; ua: string | null; linkedIds: number;
      }[]
    >`
      SELECT v."id", v."deviceId", v."firstSeenAt", v."lastSeenAt", v."eventCount",
             coalesce(s."maxScore", 0)::int AS "maxScore", coalesce(l."suspectScore", 0)::int AS "lastScore",
             l."country", l."ip", l."signals"->'attributes'->>'userAgent' AS ua, coalesce(s."linkedIds", 0)::int AS "linkedIds"
      FROM "visitors" v
      LEFT JOIN LATERAL (
        SELECT max(e."suspectScore") AS "maxScore", count(DISTINCT e."linkedId") AS "linkedIds"
        FROM "events" e WHERE e."visitorId" = v."id" AND e."projectId" = v."projectId"
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT e."suspectScore", e."country", e."ip", e."signals"
        FROM "events" e WHERE e."visitorId" = v."id" AND e."projectId" = v."projectId"
        ORDER BY e."createdAt" DESC LIMIT 1
      ) l ON true
      WHERE v."projectId" = ${projectId}::uuid
        ${like ? Prisma.sql`AND (v."id" ILIKE ${like} OR v."deviceId" ILIKE ${like})` : Prisma.empty}
        ${opts.minScore !== undefined ? Prisma.sql`AND coalesce(s."maxScore", 0) >= ${opts.minScore}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${opts.limit + 1} OFFSET ${opts.offset}`;
    const page = rows.slice(0, opts.limit);
    return {
      visitors: page.map((r) => ({
        visitorId: r.id,
        deviceId: r.deviceId,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        eventCount: r.eventCount,
        maxScore: r.maxScore,
        lastScore: r.lastScore,
        lastCountry: r.country,
        lastIp: r.ip,
        browser: r.ua ? uaLabels(r.ua).browser : null,
        os: r.ua ? uaLabels(r.ua).os : null,
        deviceType: r.ua ? uaLabels(r.ua).deviceType : null,
        linkedIds: r.linkedIds,
      })),
      nextCursor: rows.length > opts.limit ? String(opts.offset + opts.limit) : null,
    };
  }

  async linkedIds(
    projectId: string,
    opts: { limit: number; offset: number; sort: 'recent' | 'events' | 'risk' | 'devices'; q?: string },
  ): Promise<LinkedIdListResponse> {
    const order = {
      recent: Prisma.sql`max(e."createdAt") DESC`,
      events: Prisma.sql`count(*) DESC`,
      risk: Prisma.sql`max(e."suspectScore") DESC, max(e."createdAt") DESC`,
      devices: Prisma.sql`count(DISTINCT coalesce(v."deviceId", v."id")) DESC, max(e."createdAt") DESC`,
    }[opts.sort];
    const like = opts.q ? `${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.prisma.$queryRaw<
      { linkedId: string; events: number; visitors: number; devices: number; maxScore: number; first: Date; last: Date }[]
    >`
      SELECT e."linkedId" AS "linkedId", count(*)::int AS events, count(DISTINCT e."visitorId")::int AS visitors,
             count(DISTINCT coalesce(v."deviceId", v."id"))::int AS devices, max(e."suspectScore")::int AS "maxScore",
             min(e."createdAt") AS first, max(e."createdAt") AS last
      FROM "events" e JOIN "visitors" v ON v."id" = e."visitorId"
      WHERE e."projectId" = ${projectId}::uuid AND e."linkedId" IS NOT NULL
        ${like ? Prisma.sql`AND e."linkedId" ILIKE ${like}` : Prisma.empty}
      GROUP BY e."linkedId"
      ORDER BY ${order}
      LIMIT ${opts.limit + 1} OFFSET ${opts.offset}`;
    const page = rows.slice(0, opts.limit);
    return {
      accounts: page.map((r) => ({
        linkedId: r.linkedId, events: r.events, visitors: r.visitors, devices: r.devices, maxScore: r.maxScore,
        firstSeenAt: r.first.toISOString(), lastSeenAt: r.last.toISOString(),
      })),
      nextCursor: rows.length > opts.limit ? String(opts.offset + opts.limit) : null,
    };
  }
}
