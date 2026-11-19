import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { describe, expect, it } from 'vitest';
import { type LabeledExample, parseLabels, rocAuc, tuneWeights } from './tune.js';

/** Deterministic pseudo-random numbers so the test data is the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

function population(n: number): LabeledExample[] {
  const r = rng(7);
  return Array.from({ length: n }, () => {
    const fraud = r() < 0.2;
    return {
      fraud,
      detected: {
        bot: fraud ? r() < 0.7 : r() < 0.02, // strong
        antiDetect: fraud ? r() < 0.4 : r() < 0.01, // strong, rarer
        incognito: r() < 0.3, // noise: same rate for both
        vpn: fraud ? r() < 0.5 : r() < 0.15, // moderate
      },
    };
  });
}

describe('rocAuc', () => {
  it('is 1 for perfect ranking, 0.5 for ties, 0 for inverted', () => {
    expect(rocAuc([0.9, 0.8, 0.1, 0.2], [true, true, false, false])).toBe(1);
    expect(rocAuc([1, 1, 1, 1], [true, false, true, false])).toBe(0.5);
    expect(rocAuc([0.1, 0.9], [true, false])).toBe(0);
    expect(rocAuc([1, 2], [true, true])).toBeNaN();
  });
});

describe('tuneWeights', () => {
  const data = population(4000);
  const result = tuneWeights(data, { current: TEST_SCORING_CONFIG.suspect.weights });

  it('ranks informative signals above noise', () => {
    const w = result.weights;
    expect(w.bot).toBeGreaterThan(w.vpn);
    expect(w.antiDetect).toBeGreaterThan(w.vpn);
    expect(w.vpn).toBeGreaterThan(w.incognito);
    expect(w.incognito).toBeLessThanOrEqual(5);
  });

  it('keeps current weights for signals that never fired, and reports them', () => {
    expect(result.keptForLowSupport).toContain('tor');
    expect(result.weights.tor).toBe(TEST_SCORING_CONFIG.suspect.weights.tor);
    expect(result.signals.tor).toMatchObject({ fired: 0, fraudRate: null });
  });

  it('scores the data at least as well as the hand-set weights', () => {
    expect(result.auc).toBeGreaterThan(0.8);
    expect(result.auc).toBeGreaterThanOrEqual(result.currentAuc! - 0.01);
    expect(result).toMatchObject({ n: 4000 });
    expect(result.positives).toBeGreaterThan(600);
  });
});

describe('parseLabels', () => {
  it('reads fraud/legit and 1/0 labels and skips a header and junk', () => {
    const labels = parseLabels('eventId,label\ne1,fraud\ne2, legit\ne3,1\ne4,0\ne5,maybe\n\n');
    expect([...labels]).toEqual([['e1', true], ['e2', false], ['e3', true], ['e4', false]]);
  });
});
