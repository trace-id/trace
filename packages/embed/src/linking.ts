import { type FlaggedNetworkConfig } from '@trace-id/signals/config';
import { countFlaggedNeighbors, type NetworkReputation } from '@trace-id/signals/network';
import { type DeviceResponse, type LinkedVisitor } from '@trace-id/signals/api';
import { type ScoringConfig } from '@trace-id/signals/config';
import { type DeviceProfile, type DeviceReading, linkConfidence, networkFactor, profileSimilarity } from '@trace-id/signals/crossbrowser';
import { type AccountHistory, type AccountSummary, type CrossBrowserLinkSummary } from '@trace-id/signals/types';
import { type DeviceProfileRecord, type TraceStorage } from './storage.js';

const HOUR_MS = 3_600_000;
const MAX_LINKS = 10;
const MAX_NETWORKS = 20;
const MAX_DEVICE_VISITORS = 100;
const MAX_ROWS = 1000;

export interface NetworkContext {
  /** Networks this visitor used within the window, the current one included. */
  myNetworks: ReadonlySet<string>;
  /** Visitors seen on each of those networks within the window. */
  visitorsOnNetwork: ReadonlyMap<string, number>;
  /** Visitors on other networks whose hardware core is rare enough in this app to compare across networks. */
  rareHardware: ReadonlySet<string>;
}

/** Pure ranking step, separate from storage so it can be tested on its own. */
export function rankLinks(
  reading: DeviceReading,
  rows: DeviceProfileRecord[],
  ctx: NetworkContext,
  now: Date,
  config: ScoringConfig['crossBrowser'],
): LinkedVisitor[] {
  const since = now.getTime() - config.networkWindowHours * HOUR_MS;
  const byVisitor = new Map<string, { latest: DeviceProfileRecord; shared: Set<string> }>();
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
      for (const net of shared) factor = Math.max(factor, networkFactor(ctx.visitorsOnNetwork.get(net) ?? 1, shared.size, config));
    } else if (!config.requireSharedNetwork && ctx.rareHardware.has(visitorId) && similarity >= config.rareHardwareMinSimilarity) {
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
  return links.sort((a, b) => b.confidence - a.confidence || (a.lastSeenAt < b.lastSeenAt ? 1 : -1)).slice(0, MAX_LINKS);
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

/** Pure counting step for the multiAccount and accountSharing signals. */
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

/** Other browsers or profiles that look like this device. */
export async function findLinks(
  storage: TraceStorage,
  visitorId: string,
  reading: DeviceReading,
  netHash: string,
  now: Date,
  config: ScoringConfig['crossBrowser'],
): Promise<LinkedVisitor[]> {
  const since = new Date(now.getTime() - config.networkWindowHours * HOUR_MS);
  const mine = await storage.networksOfVisitor(visitorId, since, MAX_NETWORKS);
  const myNetworks = new Set([netHash, ...mine]);
  const networks = [...myNetworks];
  const [sharedRows, visitorsOnNetwork] = await Promise.all([
    storage.profilesOnNetworks(networks, visitorId, since, config.maxCandidates * 2),
    storage.visitorsPerNetwork(networks, since),
  ]);

  let rareRows: DeviceProfileRecord[] = [];
  const rareHardware = new Set<string>();
  if (!config.requireSharedNetwork && reading.coreHash && config.rareHardwareMaxVisitors > 0) {
    const sameCore = await storage.visitorIdsWithCore(reading.coreHash, visitorId, config.rareHardwareMaxVisitors + 1);
    // More than the limit means common hardware: comparing across networks would link strangers.
    if (sameCore.length > 0 && sameCore.length <= config.rareHardwareMaxVisitors) {
      for (const id of sameCore) rareHardware.add(id);
      rareRows = await storage.profilesOfVisitors([...rareHardware], config.rareHardwareMaxVisitors * MAX_NETWORKS);
    }
  }
  return rankLinks(reading, [...sharedRows, ...rareRows], { myNetworks, visitorsOnNetwork, rareHardware }, now, config);
}

export async function resolveDeviceId(storage: TraceStorage, visitorId: string, links: LinkedVisitor[], signalThreshold: number): Promise<string> {
  const strong = links.filter((l) => l.confidence >= signalThreshold).map((l) => l.visitorId);
  const rows = await storage.visitors([visitorId, ...strong]);
  return chooseDeviceId(visitorId, strong, rows);
}

/**
 * Other visitors on this network in the window, and how many were flagged (flaggedNetwork). Reads at most 30
 * neighbours' last 20 events each through the storage adapter.
 */
export async function networkReputation(
  storage: TraceStorage,
  visitorId: string,
  netHash: string,
  now: Date,
  config: FlaggedNetworkConfig,
): Promise<NetworkReputation> {
  const since = new Date(now.getTime() - config.windowHours * HOUR_MS);
  const profiles = await storage.profilesOnNetworks([netHash], visitorId, since, 200);
  const ids = [...new Set(profiles.map((p) => p.visitorId))];
  if (ids.length === 0) return { visitors: 0, flagged: 0 };
  const events = (await Promise.all(ids.slice(0, 30).map((id) => storage.eventsOfVisitor(id, 20)))).flat().filter((e) => e.createdAt >= since);
  return { visitors: ids.length, flagged: countFlaggedNeighbors(events, config.flagScore) };
}

/** The linkedId's history before this request (see AccountHistory). Bounded reads; null without a linkedId. */
export async function accountHistory(
  storage: TraceStorage,
  visitorId: string,
  deviceId: string,
  linkedId: string | null,
): Promise<AccountHistory | null> {
  if (!linkedId) return null;
  const onDevice = await storage.visitorsOnDevice(deviceId, MAX_DEVICE_VISITORS);
  const deviceIds = new Set([visitorId, ...onDevice.map((v) => v.id)]);
  const others = await storage.visitorIdsOfLinkedId(linkedId, new Date(0), visitorId, MAX_ROWS);
  const rows = (await storage.accountsOfVisitors([...new Set([visitorId, ...others, ...deviceIds])], MAX_ROWS)).filter((a) => a.linkedId === linkedId);
  const first = rows.reduce<Date | null>((min, a) => (min === null || a.firstSeenAt < min ? a.firstSeenAt : min), null);
  return { firstSeenAt: first?.toISOString() ?? null, seenOnDevice: rows.some((a) => deviceIds.has(a.visitorId)) };
}

export async function summarizeAccounts(
  storage: TraceStorage,
  visitorId: string,
  deviceId: string,
  linkedId: string | null,
  now: Date,
  windowHours: number,
): Promise<AccountSummary | null> {
  const since = new Date(now.getTime() - windowHours * HOUR_MS);
  const onDevice = await storage.visitorsOnDevice(deviceId, MAX_DEVICE_VISITORS);
  const visitorIds = [...new Set([visitorId, ...onDevice.map((v) => v.id)])];
  const [deviceAccounts, accountVisitorIds] = await Promise.all([
    storage.linkedIdsOfVisitors(visitorIds, since, MAX_ROWS),
    linkedId ? storage.visitorIdsOfLinkedId(linkedId, since, visitorId, MAX_ROWS) : Promise.resolve([]),
  ]);
  const accountVisitors = accountVisitorIds.length > 0 ? await storage.visitors(accountVisitorIds) : [];
  return countAccounts({ linkedId, deviceId }, deviceAccounts, accountVisitors);
}

/** Every browser and account seen on one device. Null when the device is unknown. */
export async function deviceView(storage: TraceStorage, deviceId: string): Promise<DeviceResponse | null> {
  const visitors = (await storage.visitorsOnDevice(deviceId, MAX_DEVICE_VISITORS)).sort(
    (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime(),
  );
  if (visitors.length === 0) return null;
  const ids = visitors.map((v) => v.id);
  const [profiles, accounts] = await Promise.all([storage.profilesOfVisitors(ids, MAX_ROWS), storage.accountsOfVisitors(ids, MAX_ROWS)]);
  const browserOf = new Map<string, { browser: string; at: number }>();
  for (const p of profiles) {
    const prev = browserOf.get(p.visitorId);
    if (!prev || p.lastSeenAt.getTime() > prev.at) browserOf.set(p.visitorId, { browser: p.browser, at: p.lastSeenAt.getTime() });
  }
  const byAccount = new Map<string, { firstSeenAt: Date; lastSeenAt: Date; visitorIds: Set<string> }>();
  for (const a of accounts) {
    const entry = byAccount.get(a.linkedId) ?? { firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt, visitorIds: new Set<string>() };
    if (a.firstSeenAt < entry.firstSeenAt) entry.firstSeenAt = a.firstSeenAt;
    if (a.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = a.lastSeenAt;
    entry.visitorIds.add(a.visitorId);
    byAccount.set(a.linkedId, entry);
  }
  return {
    deviceId,
    visitors: visitors.map((v) => ({
      visitorId: v.id,
      browser: browserOf.get(v.id)?.browser ?? null,
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
