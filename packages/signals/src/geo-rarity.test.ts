import { describe, expect, it } from 'vitest';
import { classifyBot } from './agents.js';
import { evaluateSignals } from './definitions.js';
import { geohash, toLocation } from './geo.js';
import { deviceRarity } from './rarity.js';
import { TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';

describe('geohash', () => {
  it('matches the reference encoding', () => {
    // The worked example from the geohash specification.
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(geohash(57.64911, 10.40744)).toBe('u4pr');
  });
  it('puts very close points in the same cell and distant ones apart (cells have edges: close points can still split)', () => {
    expect(geohash(30.0444, 31.2357)).toBe(geohash(30.0446, 31.2359));
    expect(geohash(30.05, 31.24)).not.toBe(geohash(31.2, 29.92));
  });
});

describe('toLocation', () => {
  it('rounds coordinates to about a kilometre and derives the zone', () => {
    expect(toLocation({ city: 'Cairo', region: 'C', latitude: 30.04442, longitude: 31.23571, accuracyRadiusKm: 20.4, timezone: 'Africa/Cairo' })).toEqual({
      city: 'Cairo', region: 'C', latitude: 30.04, longitude: 31.24, accuracyRadiusKm: 20, timezone: 'Africa/Cairo', zone: geohash(30.04442, 31.23571),
    });
  });
  it('drops out-of-range coordinates and keeps the rest', () => {
    expect(toLocation({ city: 'X', latitude: 200, longitude: 10 })).toMatchObject({ city: 'X', latitude: null, longitude: null, zone: null });
  });
});

const table = (total: number, counts: Record<string, number>) => ({ total, count: (c: string, v: string) => counts[`${c}:${v}`] ?? 0 });

describe('deviceRarity', () => {
  it('multiplies smoothed per-component shares over the hardware components', () => {
    const r = deviceRarity({ webgl: 'g', screen: 's', canvas: 'ignored' }, table(999, { 'webgl:g': 99, 'screen:s': 499 }))!;
    expect(r.total).toBe(999);
    expect(r.share).toBeCloseTo((100 / 1000) * (500 / 1000), 10);
    expect(r.components).toEqual({ webgl: 0.1, screen: 0.5 });
  });
  it('returns null without statistics or hardware components', () => {
    expect(deviceRarity({ webgl: 'g' }, table(0, {}))).toBeNull();
    expect(deviceRarity({ canvas: 'c' }, table(100, {}))).toBeNull();
  });
});

describe('rareDevice signal', () => {
  const payload = makePayload();
  it('stays quiet until the project has enough visitors', () => {
    const r = evaluateSignals(makeContext({ payload, rarity: { total: 50, share: 1e-9, components: {} } }), TEST_SCORING_CONFIG).rareDevice;
    expect(r).toEqual({ detected: false, details: { available: false, visitors: 50, minVisitors: 1000 } });
  });
  it('fires below the share threshold and names the rarest component', () => {
    const r = evaluateSignals(makeContext({ payload, rarity: { total: 5000, share: 2e-6, components: { webgl: 0.0004, screen: 0.3 } } }), TEST_SCORING_CONFIG).rareDevice;
    expect(r.detected).toBe(true);
    expect(r.details).toMatchObject({ available: true, visitors: 5000, rarest: 'webgl' });
  });
  it('does not fire for common hardware', () => {
    expect(evaluateSignals(makeContext({ payload, rarity: { total: 5000, share: 0.01, components: { webgl: 0.2 } } }), TEST_SCORING_CONFIG).rareDevice.detected).toBe(false);
  });
});

describe('proxy signal', () => {
  it('fires on a listed proxy exit and reports when no list is configured', () => {
    const base = makeContext().ip;
    expect(evaluateSignals(makeContext({ ip: { ...base, proxy: true } }), TEST_SCORING_CONFIG).proxy).toMatchObject({ detected: true, details: { available: true } });
    expect(evaluateSignals(makeContext({ ip: { ...base, proxy: false } }), TEST_SCORING_CONFIG).proxy.detected).toBe(false);
    expect(evaluateSignals(makeContext(), TEST_SCORING_CONFIG).proxy.details).toMatchObject({ available: false });
  });
});

describe('crawler verification in classifyBot', () => {
  const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  const base = { automationDetected: false, automationGlobals: [], webdriver: false, headlessUserAgent: false, userAgent: ua };
  it('marks a confirmed crawler verified and an impostor bad', () => {
    expect(classifyBot({ ...base, crawlerVerified: true })).toMatchObject({ result: 'good', identity: 'verified', name: 'Googlebot' });
    expect(classifyBot({ ...base, crawlerVerified: false })).toMatchObject({ result: 'bad', identity: 'unsigned', name: 'Googlebot' });
    expect(classifyBot({ ...base, crawlerVerified: null })).toMatchObject({ result: 'good', identity: 'unsigned' });
  });
});
