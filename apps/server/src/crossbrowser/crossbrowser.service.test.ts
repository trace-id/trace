import { DEFAULT_CROSS_BROWSER_CONFIG as CFG, type DeviceReading } from '@trace-id/signals/crossbrowser';
import { describe, expect, it } from 'vitest';
import { type CandidateRow, chooseDeviceId, type NetworkContext, rankLinks, summarizeLinks } from './crossbrowser.service.js';

const profile = { os: 'o', gpuVendor: 'v', gpu: 'g', screen: 's', cpu: 'c', timezone: 't', fonts: 'f', voices: 'x' };
const reading: DeviceReading = { profile, coreHash: null, browser: 'firefox' };
const NOW = new Date('2026-11-14T12:00:00Z');
const NET = 'n'.repeat(32);

function row(visitorId: string, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return { visitorId, netHash: NET, browser: 'chrome', profile, lastSeenAt: new Date(NOW.getTime() - 60_000), ...overrides };
}

const ctx = (overrides: Partial<NetworkContext> = {}): NetworkContext => ({
  myNetworks: new Set([NET]),
  visitorsOnNetwork: new Map([[NET, 3]]),
  rareHardware: new Set(),
  ...overrides,
});

describe('rankLinks', () => {
  it('links the same device on the same network', () => {
    const links = rankLinks(reading, [row('v1')], ctx(), NOW, CFG);
    expect(links).toEqual([
      {
        visitorId: 'v1',
        confidence: 1,
        browser: 'chrome',
        sameNetwork: true,
        sharedNetworks: 1,
        via: 'sharedNetwork',
        lastSeenAt: '2026-11-14T11:59:00.000Z',
      },
    ]);
  });

  it('links through a network both used earlier, not only the current one', () => {
    const HOME = 'h'.repeat(32);
    const links = rankLinks(reading, [row('v1', { netHash: HOME })], ctx({ myNetworks: new Set([NET, HOME]) }), NOW, CFG);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ sameNetwork: true, via: 'sharedNetwork' });
  });

  it('trusts a busy network less, and two shared networks fully', () => {
    const OTHER = 'o'.repeat(32);
    const busy = ctx({ visitorsOnNetwork: new Map([[NET, 500]]) });
    expect(rankLinks(reading, [row('v1')], busy, NOW, CFG)[0]!.confidence).toBe(0.75);
    const both = ctx({ myNetworks: new Set([NET, OTHER]), visitorsOnNetwork: new Map([[NET, 500], [OTHER, 500]]) });
    const links = rankLinks(reading, [row('v1'), row('v1', { netHash: OTHER })], both, NOW, CFG);
    expect(links[0]).toMatchObject({ confidence: 1, sharedNetworks: 2 });
  });

  it('links across networks only for rare hardware, below the signal threshold', () => {
    const elsewhere = row('v1', { netHash: 'm'.repeat(32) });
    expect(rankLinks(reading, [elsewhere], ctx(), NOW, CFG)).toEqual([]);
    const links = rankLinks(reading, [elsewhere], ctx({ rareHardware: new Set(['v1']) }), NOW, CFG);
    expect(links[0]).toMatchObject({ via: 'rareHardware', sameNetwork: false, confidence: 0.75 });
    expect(links[0]!.confidence).toBeLessThan(CFG.signalThreshold);
    expect(rankLinks(reading, [elsewhere], ctx({ rareHardware: new Set(['v1']) }), NOW, { ...CFG, requireSharedNetwork: true })).toEqual([]);
  });

  it('drops stale sightings and different hardware', () => {
    const rows = [
      row('stale', { lastSeenAt: new Date(NOW.getTime() - (CFG.networkWindowHours + 1) * 3_600_000) }),
      row('otherGpu', { profile: { ...profile, gpu: 'h' } }),
    ];
    expect(rankLinks(reading, rows, ctx(), NOW, CFG)).toEqual([]);
  });

  it('compares against the latest profile per visitor and sorts by confidence', () => {
    const partial = { ...profile, voices: 'y', fonts: 'e' };
    const links = rankLinks(reading, [row('a', { profile: partial }), row('b')], ctx(), NOW, CFG);
    expect(links.map((l) => l.visitorId)).toEqual(['b', 'a']);
    expect(links[1]!.confidence).toBeLessThan(1);
    expect(summarizeLinks(links)).toEqual({ linkedCount: 2, topConfidence: 1, browsers: ['chrome'] });
  });
});

describe('chooseDeviceId', () => {
  const at = (minute: number) => new Date(NOW.getTime() + minute * 60_000);

  it('starts its own device id without links, and keeps an existing one', () => {
    expect(chooseDeviceId('new', [], [])).toBe('new');
    expect(chooseDeviceId('v', [], [{ id: 'v', deviceId: 'd1', firstSeenAt: at(0) }])).toBe('d1');
  });

  it('takes the device id of the first-seen browser among itself and its strong links', () => {
    const rows = [
      { id: 'edge', deviceId: null, firstSeenAt: at(2) },
      { id: 'chrome', deviceId: null, firstSeenAt: at(1) },
    ];
    expect(chooseDeviceId('firefox', ['edge', 'chrome'], rows)).toBe('chrome');
    expect(chooseDeviceId('chrome', ['edge'], rows)).toBe('chrome');
    expect(chooseDeviceId('edge', ['chrome'], [...rows, { id: 'x', deviceId: 'zzz', firstSeenAt: at(0) }])).toBe('chrome');
    expect(chooseDeviceId('edge', ['chrome'], [rows[0]!, { id: 'chrome', deviceId: 'older', firstSeenAt: at(1) }])).toBe('older');
  });
});
