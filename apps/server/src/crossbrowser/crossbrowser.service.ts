import { type FlaggedNetworkConfig } from '@trace-id/signals/config';
import { countFlaggedNeighbors, type NetworkReputation } from '@trace-id/signals/network';
import { Inject, Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type LinkedVisitor } from '@trace-id/signals/api';
import { type ScoringConfig } from '@trace-id/signals/config';
import {
  type DeviceProfile,
  type DeviceReading,
  linkConfidence,
  networkFactor,
  profileSimilarity,
} from '@trace-id/signals/crossbrowser';
import { type CrossBrowserLinkSummary } from '@trace-id/signals/types';
import { ENV, type Env } from '../config/env.js';
import { SCORING } from '../config/scoring.js';
import { PrismaService } from '../infra/prisma.service.js';
import { networkKey } from '../intel/ip-storage.js';

const HOUR_MS = 3_600_000;
const MAX_LINKS = 10;
const MAX_NETWORKS = 20;

export interface CandidateRow {
  visitorId: string;
  netHash: string;
  browser: string;
  profile: unknown;
  lastSeenAt: Date;
}

export interface NetworkContext {
  /** Networks this visitor used within the window, the current one included. */
  myNetworks: ReadonlySet<string>;
  /** Visitors seen on each of those networks within the window. */
  visitorsOnNetwork: ReadonlyMap<string, number>;
  /** Visitors on other networks whose hardware core is rare enough in this project to compare across networks. */
  rareHardware: ReadonlySet<string>;
}

/** Pure ranking step, separate from the database so it can be tested on its own. */
export function rankLinks(
  reading: DeviceReading,
  rows: CandidateRow[],
  ctx: NetworkContext,
  now: Date,
  config: ScoringConfig['crossBrowser'],
): LinkedVisitor[] {
  const since = now.getTime() - config.networkWindowHours * HOUR_MS;
  const byVisitor = new Map<string, { latest: CandidateRow; shared: Set<string> }>();
  for (const row of rows) {
    const entry = byVisitor.get(row.visitorId) ?? { latest: row, shared: new Set<string>() };
    if (row.lastSeenAt > entry.latest.lastSeenAt) entry.latest = row;
    if (ctx.myNetworks.has(row.netHash) && row.lastSeenAt.getTime() >= since) entry.shared.add(row.netHash);
    byVisitor.set(row.visitorId, entry);
  }

  const links: LinkedVisitor[] = [];
  for (const [visitorId, { latest, shared }] of byVisitor) {
    const similarity = profileSimilarity(reading.profile, (latest.profile ?? {}) as DeviceProfile, config);
    let factor = 0;
    let via: LinkedVisitor['via'] = 'sharedNetwork';
    if (shared.size > 0) {
      for (const net of shared) {
        factor = Math.max(factor, networkFactor(ctx.visitorsOnNetwork.get(net) ?? 1, shared.size, config));
      }
    } else if (
      !config.requireSharedNetwork &&
      ctx.rareHardware.has(visitorId) &&
      similarity >= config.rareHardwareMinSimilarity
    ) {
      factor = config.otherNetworkFactor;
      via = 'rareHardware';
    }
    const confidence = linkConfidence(similarity, factor);
    if (confidence < config.linkThreshold) continue;
    links.push({
      visitorId,
      confidence,
      browser: latest.browser,
      sameNetwork: shared.size > 0,
      sharedNetworks: shared.size,
      via,
      lastSeenAt: latest.lastSeenAt.toISOString(),
    });
  }
  return links
    .sort((a, b) => b.confidence - a.confidence || (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
    .slice(0, MAX_LINKS);
}

export interface DeviceCandidate {
  id: string;
  deviceId: string | null;
  firstSeenAt: Date;
}

/**
 * The device id is the id of the first-seen browser among this visitor and its strong links, so every browser on a
 * device converges on one value. Without strong links a visitor keeps the device id it has, or starts its own.
 */
export function chooseDeviceId(visitorId: string, strongLinkIds: string[], rows: DeviceCandidate[]): string {
  const self = rows.find((r) => r.id === visitorId);
  if (strongLinkIds.length === 0) return self?.deviceId ?? visitorId;
  const pool = rows.filter((r) => r.id === visitorId || strongLinkIds.includes(r.id));
  const oldest = [...pool].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || (a.id < b.id ? -1 : 1))[0];
  if (!oldest) return self?.deviceId ?? visitorId;
  return oldest.deviceId ?? oldest.id;
}

export function summarizeLinks(links: LinkedVisitor[]): CrossBrowserLinkSummary {
  return {
    linkedCount: links.length,
    topConfidence: links[0]?.confidence ?? 0,
    browsers: [...new Set(links.map((l) => l.browser))].sort(),
  };
}

/**
 * Finds other visitors of the same project that look like this device in another browser or browser profile.
 * Every query is scoped by projectId.
 */
@Injectable()
export class CrossBrowserService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SCORING) private readonly scoring: ScoringConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Null when linking is off: disabled by the operator, or IPs are not to be used at all (IP_STORAGE=none). */
  networkKeyFor(ip: string): string | null {
    if (!this.env.CROSS_BROWSER_LINKING || this.env.IP_STORAGE === 'none') return null;
    return networkKey(ip, this.env.TOKEN_SECRET);
  }

  async findLinks(
    projectId: string,
    visitorId: string,
    reading: DeviceReading,
    netHash: string,
    now: Date,
  ): Promise<LinkedVisitor[]> {
    const config = this.scoring.crossBrowser;
    const since = new Date(now.getTime() - config.networkWindowHours * HOUR_MS);
    const select = { visitorId: true, netHash: true, browser: true, profile: true, lastSeenAt: true } as const;

    // Every network this browser used recently, so a device seen at home in Chrome and at work in Firefox, then at
    // work in Chrome, links even though the two browsers were never online on the same network at the same time.
    const mine = await this.prisma.deviceProfile.findMany({
      where: { projectId, visitorId, lastSeenAt: { gte: since } },
      select: { netHash: true },
      orderBy: { lastSeenAt: 'desc' },
      take: MAX_NETWORKS,
    });
    const myNetworks = new Set([netHash, ...mine.map((r) => r.netHash)]);
    const networks = [...myNetworks];

    const [sharedRows, counts] = await Promise.all([
      this.prisma.deviceProfile.findMany({
        where: { projectId, visitorId: { not: visitorId }, netHash: { in: networks }, lastSeenAt: { gte: since } },
        select,
        orderBy: { lastSeenAt: 'desc' },
        take: config.maxCandidates * 2,
      }),
      this.prisma.deviceProfile.groupBy({
        by: ['netHash'],
        where: { projectId, netHash: { in: networks }, lastSeenAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const visitorsOnNetwork = new Map(counts.map((c) => [c.netHash, c._count._all]));

    let rareRows: CandidateRow[] = [];
    const rareHardware = new Set<string>();
    if (!config.requireSharedNetwork && reading.coreHash && config.rareHardwareMaxVisitors > 0) {
      const sameCore = await this.prisma.deviceProfile.findMany({
        where: { projectId, coreHash: reading.coreHash, visitorId: { not: visitorId } },
        distinct: ['visitorId'],
        select: { visitorId: true },
        take: config.rareHardwareMaxVisitors + 1,
      });
      // More than the limit means common hardware: comparing across networks would link strangers.
      if (sameCore.length > 0 && sameCore.length <= config.rareHardwareMaxVisitors) {
        for (const r of sameCore) rareHardware.add(r.visitorId);
        rareRows = await this.prisma.deviceProfile.findMany({
          where: { projectId, visitorId: { in: [...rareHardware] } },
          select,
          orderBy: { lastSeenAt: 'desc' },
          take: config.rareHardwareMaxVisitors * MAX_NETWORKS,
        });
      }
    }

    return rankLinks(reading, [...sharedRows, ...rareRows], { myNetworks, visitorsOnNetwork, rareHardware }, now, config);
  }

  /**
   * Other visitors on this network in the window, and how many of them were flagged (flaggedNetwork). Bounded: at most
   * 200 neighbours and 1000 of their high-scoring events are read.
   */
  async networkReputation(projectId: string, visitorId: string, netHash: string, now: Date, config: FlaggedNetworkConfig): Promise<NetworkReputation> {
    const since = new Date(now.getTime() - config.windowHours * HOUR_MS);
    const neighbors = await this.prisma.deviceProfile.findMany({
      where: { projectId, netHash, visitorId: { not: visitorId }, lastSeenAt: { gte: since } },
      select: { visitorId: true },
      distinct: ['visitorId'],
      take: 200,
    });
    if (neighbors.length === 0) return { visitors: 0, flagged: 0 };
    const events = await this.prisma.event.findMany({
      where: { projectId, visitorId: { in: neighbors.map((n) => n.visitorId) }, createdAt: { gte: since }, suspectScore: { gte: config.flagScore } },
      select: { visitorId: true, suspectScore: true, reasons: true },
      take: 1000,
    });
    return { visitors: neighbors.length, flagged: countFlaggedNeighbors(events, config.flagScore) };
  }

  async resolveDeviceId(projectId: string, visitorId: string, links: LinkedVisitor[]): Promise<string> {
    const strong = links.filter((l) => l.confidence >= this.scoring.crossBrowser.signalThreshold).map((l) => l.visitorId);
    const rows = await this.prisma.visitor.findMany({
      where: { projectId, id: { in: [visitorId, ...strong] } },
      select: { id: true, deviceId: true, firstSeenAt: true },
    });
    return chooseDeviceId(visitorId, strong, rows);
  }

  /** Runs inside the ingest transaction, after the visitor row exists. */
  upsert(projectId: string, visitorId: string, reading: DeviceReading, netHash: string, now: Date) {
    const data = {
      coreHash: reading.coreHash,
      browser: reading.browser,
      profile: reading.profile as Prisma.InputJsonObject,
      lastSeenAt: now,
    };
    return this.prisma.deviceProfile.upsert({
      where: { visitorId_netHash: { visitorId, netHash } },
      create: { visitorId, netHash, projectId, ...data },
      update: data,
    });
  }
}
