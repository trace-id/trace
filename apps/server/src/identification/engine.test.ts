import { TEST_SCORING_CONFIG, makePayload } from '@trace-id/signals/testing';
import { type Components } from '@trace-id/signals/types';
import { describe, expect, it } from 'vitest';
import { bucketHashes, type CandidateSource, matchVisitor, type VisitorSnapshot } from './engine.js';

// The original weighted matcher; the linkage matcher has its own block below.
const cfg = { ...TEST_SCORING_CONFIG.identification, method: 'weighted' as const };
const lcfg = TEST_SCORING_CONFIG.identification;
const BASE = makePayload().components;

function source(visitors: VisitorSnapshot[]): CandidateSource & { bucketCalls: number } {
  const s = {
    bucketCalls: 0,
    async byBuckets(hashes: string[]) {
      s.bucketCalls++;
      return visitors.filter((v) => bucketHashes(v.components, cfg.buckets).some((h) => hashes.includes(h)));
    },
    async byId(id: string) {
      return visitors.find((v) => v.id === id) ?? null;
    },
  };
  return s;
}

function visitor(id: string, components: Components, lastSeen = '2026-11-01T00:00:00Z'): VisitorSnapshot {
  return { id, components, lastSeenAt: new Date(lastSeen) };
}

describe('bucketHashes', () => {
  it('emits one hash per complete bucket', () => {
    expect(bucketHashes(BASE, cfg.buckets)).toHaveLength(3);
    const { canvas: _c, ...noCanvas } = BASE;
    expect(bucketHashes(noCanvas, cfg.buckets)).toHaveLength(2);
  });

  it('is deterministic and order-sensitive per bucket', () => {
    expect(bucketHashes(BASE, cfg.buckets)).toEqual(bucketHashes({ ...BASE }, cfg.buckets));
    expect(bucketHashes({ ...BASE, audio: 'other' }, cfg.buckets)[0]).not.toBe(bucketHashes(BASE, cfg.buckets)[0]);
  });
});

describe('matchVisitor', () => {
  it('trusts a token whose visitor still agrees', async () => {
    const d = await matchVisitor({ components: BASE, tokenVisitorId: 'v1' }, source([visitor('v1', BASE)]), cfg);
    expect(d).toMatchObject({ kind: 'token', visitorId: 'v1', confidence: 0.99 });
  });

  it('ignores a token copied onto a different device', async () => {
    const other: Components = Object.fromEntries(Object.keys(BASE).map((k) => [k, 'zz'])) as Components;
    const d = await matchVisitor({ components: other, tokenVisitorId: 'v1' }, source([visitor('v1', BASE)]), cfg);
    expect(d.kind).toBe('new');
  });

  it('ignores a token for a visitor that no longer exists', async () => {
    const d = await matchVisitor({ components: BASE, tokenVisitorId: 'gone' }, source([visitor('v1', BASE)]), cfg);
    expect(d).toMatchObject({ kind: 'similar', visitorId: 'v1' });
  });

  it('matches the same device in incognito (no token, identical stable signals)', async () => {
    const d = await matchVisitor({ components: BASE, tokenVisitorId: null }, source([visitor('v1', BASE)]), cfg);
    expect(d).toMatchObject({ kind: 'similar', visitorId: 'v1', similarity: 1, confidence: 1 });
  });

  it('matches across a minor browser update (css + media changed)', async () => {
    const updated = { ...BASE, css: 'css2', media: 'md2' };
    const d = await matchVisitor({ components: updated, tokenVisitorId: null }, source([visitor('v1', BASE)]), cfg);
    expect(d.kind).toBe('similar');
    expect(d.similarity).toBeGreaterThan(cfg.matchThreshold);
  });

  it('keeps similar-looking devices apart (same hardware, different fonts, timezone, languages)', async () => {
    const twin = { ...BASE, fonts: 'f2', timezone: 'tz2', languages: 'l2' };
    const d = await matchVisitor({ components: twin, tokenVisitorId: null }, source([visitor('v1', BASE)]), cfg);
    expect(d.kind).toBe('new');
    expect(d.similarity).toBeGreaterThan(0.7);
    expect(d.confidence).toBeLessThan(0.7);
  });

  it('creates a new visitor when nothing shares a bucket', async () => {
    const stranger = Object.fromEntries(Object.keys(BASE).map((k) => [k, `x-${k}`])) as Components;
    const d = await matchVisitor({ components: stranger, tokenVisitorId: null }, source([visitor('v1', BASE)]), cfg);
    expect(d).toEqual({ kind: 'new', visitorId: null, confidence: 1, similarity: 0 });
  });

  it('discounts confidence when two candidates are equally close, and picks deterministically', async () => {
    const visitors = [visitor('vB', BASE, '2026-11-01T00:00:00Z'), visitor('vA', BASE, '2026-11-01T00:00:00Z')];
    const d1 = await matchVisitor({ components: BASE, tokenVisitorId: null }, source(visitors), cfg);
    const d2 = await matchVisitor({ components: BASE, tokenVisitorId: null }, source([...visitors].reverse()), cfg);
    expect(d1).toEqual(d2);
    expect(d1).toMatchObject({ kind: 'similar', visitorId: 'vA', confidence: 0.5 });
  });

  it('prefers the most recently seen candidate on a similarity tie', async () => {
    const visitors = [visitor('vOld', BASE, '2026-10-01T00:00:00Z'), visitor('vNew', BASE, '2026-11-10T00:00:00Z')];
    const d = await matchVisitor({ components: BASE, tokenVisitorId: null }, source(visitors), cfg);
    expect(d.visitorId).toBe('vNew');
  });

  it('skips the candidate query when no bucket is complete', async () => {
    const s = source([visitor('v1', BASE)]);
    const d = await matchVisitor({ components: { math: 'm1' }, tokenVisitorId: null }, s, cfg);
    expect(d.kind).toBe('new');
    expect(s.bucketCalls).toBe(0);
  });
});

describe('matchVisitor with linkage', () => {
  it('matches an identical device and reports the weighted similarity alongside the probability', async () => {
    const d = await matchVisitor({ components: BASE, tokenVisitorId: null }, source([visitor('v1', BASE)]), lcfg);
    expect(d).toMatchObject({ kind: 'similar', visitorId: 'v1', similarity: 1 });
    expect(d.confidence).toBeGreaterThan(0.97);
  });

  it('matches across a major browser update the weighted matcher misses', async () => {
    const updated = { ...BASE, css: 'css2', media: 'md2', webglParams: 'wp2' };
    const weighted = await matchVisitor({ components: updated, tokenVisitorId: null }, source([visitor('v1', BASE)]), cfg);
    const linked = await matchVisitor({ components: updated, tokenVisitorId: null }, source([visitor('v1', BASE)]), lcfg);
    expect(weighted.kind).toBe('new');
    expect(linked).toMatchObject({ kind: 'similar', visitorId: 'v1' });
  });

  it('keeps apart a device with the same GPU but different hardware, screen, time zone and languages', async () => {
    const stranger = { ...BASE, hardware: 'h2', screen: 's2', timezone: 'tz2', languages: 'l2' };
    const d = await matchVisitor({ components: stranger, tokenVisitorId: null }, source([visitor('v1', BASE)]), lcfg);
    expect(d.kind).toBe('new');
  });

  it('uses the source frequencies when it has them', async () => {
    const src = source([visitor('v1', BASE)]);
    let asked = 0;
    const withStats = { ...src, frequencies: async () => (asked++, { total: 100_000, count: () => 40_000 }) };
    const twin = { ...BASE, fonts: 'f2' };
    const d = await matchVisitor({ components: twin, tokenVisitorId: null }, withStats, lcfg);
    expect(asked).toBe(1);
    // Every shared value is common (40% of visitors): agreement on them proves little.
    expect(d.kind).toBe('new');
  });
});
