import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, makeContext } from './testing.js';
import { type EvaluationContext } from './types.js';

describe('replayedRequest signal', () => {
  it('fires when the nonce was seen before, and reports not available without a nonce store', () => {
    const run = (replay: EvaluationContext['replay']) =>
      evaluateSignals(makeContext({ replay }), TEST_SCORING_CONFIG).replayedRequest;
    expect(run({ nonceSeen: true, sentAgoMs: 120_000 })).toEqual({ detected: true, details: { available: true, sentAgoMs: 120_000 } });
    expect(run({ nonceSeen: false, sentAgoMs: 40 }).detected).toBe(false);
    expect(run(null)).toEqual({ detected: false, details: { available: false } });
    expect(evaluateSignals(makeContext(), TEST_SCORING_CONFIG).replayedRequest.details).toEqual({ available: false });
  });
});
