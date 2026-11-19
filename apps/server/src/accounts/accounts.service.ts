import { Inject, Injectable } from '@nestjs/common';
import { type DeviceResponse } from '@trace-id/signals/api';
import { type ScoringConfig } from '@trace-id/signals/config';
import { type AccountHistory, type AccountSummary } from '@trace-id/signals/types';
import { ApiError } from '../common/api-error.js';
import { SCORING } from '../config/scoring.js';
import { PrismaService } from '../infra/prisma.service.js';

const HOUR_MS = 3_600_000;
const MAX_DEVICE_VISITORS = 100;
const MAX_ROWS = 1000;
const DEVICE_ID = /^[0-9A-Za-z]{20}$/;

/** Pure counting step, separate from the database so it can be tested on its own. */
export function countAccounts(
  current: { linkedId: string | null; deviceId: string },
  deviceAccounts: string[],
  accountVisitors: { id: string; deviceId: string | null }[],
): AccountSummary | null {
  const accounts = new Set(deviceAccounts);
  if (current.linkedId) accounts.add(current.linkedId);
  if (accounts.size === 0) return null;
  let devicesForAccount: number | null = null;
  if (current.linkedId) {
    const devices = new Set(accountVisitors.map((v) => v.deviceId ?? v.id));
    devices.add(current.deviceId);
    devicesForAccount = devices.size;
  }
  return { accountsOnDevice: accounts.size, devicesForAccount };
}

/**
 * Accounts (the customer's linkedId) per device, and devices per account. Every query is scoped by projectId.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(SCORING) private readonly scoring: ScoringConfig,
    private readonly prisma: PrismaService,
  ) {}

  private async deviceVisitorIds(projectId: string, deviceId: string, extra: string[] = []): Promise<string[]> {
    const rows = await this.prisma.visitor.findMany({
      where: { projectId, OR: [{ deviceId }, { id: deviceId }] },
      select: { id: true },
      orderBy: { lastSeenAt: 'desc' },
      take: MAX_DEVICE_VISITORS,
    });
    return [...new Set([...extra, ...rows.map((r) => r.id)])];
  }

  async summarize(
    projectId: string,
    visitorId: string,
    deviceId: string,
    linkedId: string | null,
    now: Date,
  ): Promise<AccountSummary | null> {
    const since = new Date(now.getTime() - this.scoring.accounts.windowHours * HOUR_MS);
    const visitorIds = await this.deviceVisitorIds(projectId, deviceId, [visitorId]);
    const [onDevice, forAccount] = await Promise.all([
      this.prisma.visitorAccount.findMany({
        where: { projectId, visitorId: { in: visitorIds }, lastSeenAt: { gte: since } },
        distinct: ['linkedId'],
        select: { linkedId: true },
        take: MAX_ROWS,
      }),
      linkedId
        ? this.prisma.visitorAccount.findMany({
            where: { projectId, linkedId, lastSeenAt: { gte: since }, visitorId: { not: visitorId } },
            select: { visitorId: true },
            take: MAX_ROWS,
          })
        : Promise.resolve([]),
    ]);
    const accountVisitors =
      forAccount.length > 0
        ? await this.prisma.visitor.findMany({
            where: { projectId, id: { in: forAccount.map((r) => r.visitorId) } },
            select: { id: true, deviceId: true },
          })
        : [];
    return countAccounts({ linkedId, deviceId }, onDevice.map((r) => r.linkedId), accountVisitors);
  }

  /**
   * The linkedId's history before this request: when any visitor first used it, and whether this device did. Null
   * without a linkedId. Feeds the fraud score's account-age features.
   */
  async history(projectId: string, visitorId: string, deviceId: string, linkedId: string | null): Promise<AccountHistory | null> {
    if (!linkedId) return null;
    const visitorIds = await this.deviceVisitorIds(projectId, deviceId, [visitorId]);
    const [first, onDevice] = await Promise.all([
      this.prisma.visitorAccount.aggregate({ where: { projectId, linkedId }, _min: { firstSeenAt: true } }),
      this.prisma.visitorAccount.findFirst({ where: { projectId, linkedId, visitorId: { in: visitorIds } }, select: { visitorId: true } }),
    ]);
    return { firstSeenAt: first._min.firstSeenAt?.toISOString() ?? null, seenOnDevice: onDevice !== null };
  }

  /** Runs inside the ingest transaction, after the visitor row exists. */
  upsert(projectId: string, visitorId: string, linkedId: string, now: Date) {
    return this.prisma.visitorAccount.upsert({
      where: { visitorId_linkedId: { visitorId, linkedId } },
      create: { visitorId, linkedId, projectId, firstSeenAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
  }

  async device(projectId: string, deviceId: string): Promise<DeviceResponse> {
    if (!DEVICE_ID.test(deviceId)) throw ApiError.badRequest('deviceId is not valid', 'invalid_device_id');
    const visitors = await this.prisma.visitor.findMany({
      where: { projectId, OR: [{ deviceId }, { id: deviceId, deviceId: null }] },
      select: { id: true, firstSeenAt: true, lastSeenAt: true, eventCount: true },
      orderBy: { firstSeenAt: 'asc' },
      take: MAX_DEVICE_VISITORS,
    });
    if (visitors.length === 0) throw ApiError.notFound('Device not found');
    const ids = visitors.map((v) => v.id);
    const [profiles, accounts] = await Promise.all([
      this.prisma.deviceProfile.findMany({
        where: { projectId, visitorId: { in: ids } },
        select: { visitorId: true, browser: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.visitorAccount.findMany({
        where: { projectId, visitorId: { in: ids } },
        select: { visitorId: true, linkedId: true, firstSeenAt: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'desc' },
        take: MAX_ROWS,
      }),
    ]);
    const browserOf = new Map<string, string>();
    for (const p of profiles) if (!browserOf.has(p.visitorId)) browserOf.set(p.visitorId, p.browser);

    const byAccount = new Map<string, { firstSeenAt: Date; lastSeenAt: Date; visitorIds: Set<string> }>();
    for (const a of accounts) {
      const entry = byAccount.get(a.linkedId) ?? { firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt, visitorIds: new Set() };
      if (a.firstSeenAt < entry.firstSeenAt) entry.firstSeenAt = a.firstSeenAt;
      if (a.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = a.lastSeenAt;
      entry.visitorIds.add(a.visitorId);
      byAccount.set(a.linkedId, entry);
    }

    return {
      deviceId,
      visitors: visitors.map((v) => ({
        visitorId: v.id,
        browser: browserOf.get(v.id) ?? null,
        firstSeenAt: v.firstSeenAt.toISOString(),
        lastSeenAt: v.lastSeenAt.toISOString(),
        eventCount: v.eventCount,
      })),
      accounts: [...byAccount.entries()]
        .sort((a, b) => b[1].lastSeenAt.getTime() - a[1].lastSeenAt.getTime())
        .map(([linkedId, e]) => ({
          linkedId,
          firstSeenAt: e.firstSeenAt.toISOString(),
          lastSeenAt: e.lastSeenAt.toISOString(),
          visitorIds: [...e.visitorIds].sort(),
        })),
    };
  }
}
