import { describe, expect, it } from 'vitest';
import { candidatePrior, DEFAULT_LINKAGE_CONFIG as CFG, EMPTY_FREQUENCIES, type FrequencyTable, linkageScore, smoothedFrequency } from './linkage.js';
import { makePayload } from './testing.js';
import { type Components } from './types.js';

const a = makePayload().components;
function table(total: number, counts: Record<string, number>): FrequencyTable {
  return { total, count: (c, v) => counts[`${c}:${v}`] ?? 0 };
}

describe('smoothedFrequency', () => {
  it('starts at the prior and moves to the observed share as visitors accumulate', () => {
    expect(smoothedFrequency(EMPTY_FREQUENCIES, 'platform', 'x', CFG)).toBeCloseTo(0.4);
    expect(smoothedFrequency(table(10_000, { 'platform:x': 6000 }), 'platform', 'x', CFG)).toBeCloseTo(0.6, 2);
    expect(smoothedFrequency(table(10_000, {}), 'canvas', 'rare', CFG)).toBeLessThan(0.001);
  });
});

describe('linkageScore', () => {
  it('needs enough shared components', () => {
    expect(linkageScore({ canvas: 'x' }, { canvas: 'x' }, EMPTY_FREQUENCIES, CFG).probability).toBe(0);
  });

  it('is near certain for identical components and low when stable hardware differs', () => {
    expect(linkageScore(a, a, EMPTY_FREQUENCIES, CFG).probability).toBeGreaterThan(0.99);
    const other: Components = { ...a, webgl: 'w2', canvas: 'c2', hardware: 'h2', screen: 's2', timezone: 'tz2' };
    expect(linkageScore(a, other, EMPTY_FREQUENCIES, CFG).probability).toBeLessThan(0.1);
  });

  it('forgives volatile components (a browser update) more than stable ones', () => {
    const updated: Components = { ...a, css: 'css2', media: 'md2', webglParams: 'wp2' };
    const newGpu: Components = { ...a, webgl: 'w2', canvas: 'c2', audio: 'a2' };
    const u = linkageScore(a, updated, EMPTY_FREQUENCIES, CFG);
    const g = linkageScore(a, newGpu, EMPTY_FREQUENCIES, CFG);
    expect(u.probability).toBeGreaterThan(CFG.matchProbability);
    expect(g.logLikelihoodRatio).toBeLessThan(u.logLikelihoodRatio);
  });

  it('trusts a match on rare values more than one on common values', () => {
    const common = table(10_000, Object.fromEntries(Object.entries(a).map(([k, v]) => [`${k}:${v}`, 3000])));
    const rare = table(10_000, Object.fromEntries(Object.entries(a).map(([k, v]) => [`${k}:${v}`, 2])));
    expect(linkageScore(a, a, rare, CFG).logLikelihoodRatio).toBeGreaterThan(linkageScore(a, a, common, CFG).logLikelihoodRatio + 5);
  });

  it('counts one agreement per correlated group', () => {
    const noGroups = { ...CFG, groups: [] };
    expect(linkageScore(a, a, EMPTY_FREQUENCIES, noGroups).logLikelihoodRatio).toBeGreaterThan(
      linkageScore(a, a, EMPTY_FREQUENCIES, CFG).logLikelihoodRatio,
    );
  });
});

describe('candidatePrior', () => {
  it('gets stricter as more candidates compete', () => {
    expect(candidatePrior(1, CFG)).toBeGreaterThan(candidatePrior(50, CFG));
    expect(candidatePrior(1, { ...CFG, priorLogOdds: 0 })).toBeCloseTo(0);
  });
});
