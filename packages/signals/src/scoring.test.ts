import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { computeSuspectScore } from './scoring.js';
import { CLEAN_IP, TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';

describe('computeSuspectScore', () => {
  it('is 0 with no reasons for a clean visitor', () => {
    expect(computeSuspectScore(evaluateSignals(makeContext(), TEST_SCORING_CONFIG), TEST_SCORING_CONFIG)).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it('sums weights, orders reasons by contribution and caps at 100', () => {
    const ctx = makeContext({
      payload: makePayload({ bot: { webdriver: true } }),
      ip: { ...CLEAN_IP, tor: true, blocklisted: true },
    });
    const s = computeSuspectScore(evaluateSignals(ctx, TEST_SCORING_CONFIG), TEST_SCORING_CONFIG);
    expect(s.score).toBe(100);
    expect(s.reasons).toEqual([
      { signal: 'bot', contribution: 60 },
      { signal: 'ipBlocklist', contribution: 40 },
      { signal: 'tor', contribution: 30 },
    ]);
  });
});

describe('TEST_SCORING_CONFIG', () => {
  it('mirrors scoring.default.json', () => {
    const file = JSON.parse(readFileSync(new URL('../../../scoring.default.json', import.meta.url), 'utf8')) as unknown;
    expect(file).toEqual(TEST_SCORING_CONFIG);
  });
});
