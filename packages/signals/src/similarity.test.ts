import { describe, expect, it } from 'vitest';
import { componentSimilarity } from './similarity.js';
import { TEST_SCORING_CONFIG, makePayload } from './testing.js';

const cfg = TEST_SCORING_CONFIG.identification;

describe('componentSimilarity', () => {
  it('is 1 for identical components', () => {
    const c = makePayload().components;
    expect(componentSimilarity(c, c, cfg)).toBe(1);
  });

  it('drops by the weight share of differing components', () => {
    const a = makePayload().components;
    const b = { ...a, timezone: 'tz2' };
    const total = Object.values(cfg.componentWeights).reduce((s, w) => s + w, 0);
    expect(componentSimilarity(a, b, cfg)).toBeCloseTo((total - 1) / total, 10);
  });

  it('ignores components missing on one side', () => {
    const a = makePayload().components;
    const { audio: _audio, ...b } = a;
    expect(componentSimilarity(a, b, cfg)).toBe(1);
  });

  it('returns 0 when the overlap is too small to judge', () => {
    expect(componentSimilarity({ canvas: 'x', timezone: 't' }, { canvas: 'x', timezone: 't' }, cfg)).toBe(0);
  });
});
