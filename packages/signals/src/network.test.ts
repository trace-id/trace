import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { countFlaggedNeighbors } from './network.js';
import { TEST_SCORING_CONFIG, makeContext } from './testing.js';

describe('countFlaggedNeighbors', () => {
  it('counts distinct visitors at or above the flag score, without their own flaggedNetwork points', () => {
    expect(
      countFlaggedNeighbors(
        [
          { visitorId: 'a', suspectScore: 90, reasons: [{ signal: 'bot', contribution: 60 }, { signal: 'tor', contribution: 30 }] },
          { visitorId: 'a', suspectScore: 80, reasons: [] },
          { visitorId: 'b', suspectScore: 75, reasons: [{ signal: 'bot', contribution: 60 }, { signal: 'flaggedNetwork', contribution: 15 }] },
          { visitorId: 'c', suspectScore: 70, reasons: 'not an array' },
        ],
        70,
      ),
    ).toBe(2);
  });
});

describe('flaggedNetwork signal', () => {
  const run = (network: { visitors: number; flagged: number } | null) =>
    evaluateSignals(makeContext({ network }), TEST_SCORING_CONFIG).flaggedNetwork;

  it('fires with enough flagged neighbours that are a large enough share', () => {
    expect(run({ visitors: 4, flagged: 2 })).toEqual({
      detected: true,
      details: { available: true, visitors: 4, flagged: 2, share: 0.5, minFlagged: 2 },
    });
    expect(run({ visitors: 4, flagged: 1 }).detected).toBe(false);
    // A big shared network (carrier, office) with a few flagged visitors stays quiet.
    expect(run({ visitors: 200, flagged: 10 }).detected).toBe(false);
    expect(run({ visitors: 0, flagged: 0 }).detected).toBe(false);
  });

  it('is not available without the network key', () => {
    expect(run(null)).toEqual({ detected: false, details: { available: false } });
    expect(evaluateSignals(makeContext(), TEST_SCORING_CONFIG).flaggedNetwork.details).toEqual({ available: false });
  });

  it('uses defaults when an older config has no flaggedNetwork section', () => {
    const { flaggedNetwork: _omit, ...old } = TEST_SCORING_CONFIG;
    expect(evaluateSignals(makeContext({ network: { visitors: 3, flagged: 2 } }), old).flaggedNetwork.detected).toBe(true);
  });
});
