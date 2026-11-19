import { describe, expect, it } from 'vitest';
import { languageHeaderMismatch } from './antidetect.js';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT, makeContext, makePayload } from './testing.js';
import { type BehaviorSummary, type EvaluationContext } from './types.js';

const HUMAN: BehaviorSummary = {
  msSinceStart: 8200,
  pointerMoves: 140,
  clicks: 2,
  keys: 12,
  scrolls: 3,
  touches: 0,
  untrusted: 0,
  straightness: 0.41,
  keyIntervalStdMs: 48.5,
};
const run = (ctx: Partial<EvaluationContext>) => evaluateSignals(makeContext(ctx), TEST_SCORING_CONFIG);
const withBehavior = (b: Partial<BehaviorSummary>) => run({ payload: { ...makePayload(), behavior: { ...HUMAN, ...b } } });

describe('automatedInput', () => {
  it('is unavailable without behaviour and quiet for a person', () => {
    expect(run({}).automatedInput.details).toEqual({ available: false });
    expect(withBehavior({}).automatedInput.detected).toBe(false);
  });

  it('flags scripted events, ruler-straight paths and machine-regular typing', () => {
    expect(withBehavior({ untrusted: 3 }).automatedInput.details.reasons).toEqual(['syntheticEvents']);
    expect(withBehavior({ straightness: 1 }).automatedInput.details.reasons).toEqual(['linearPointer']);
    expect(withBehavior({ keyIntervalStdMs: 0.4 }).automatedInput.details.reasons).toEqual(['robotTyping']);
    expect(withBehavior({ straightness: null, keyIntervalStdMs: null }).automatedInput.detected).toBe(false);
  });
});

describe('languageHeaderMismatch', () => {
  it('compares the primary language of the header and the page', () => {
    expect(languageHeaderMismatch('en-US,en;q=0.9', ['en-US', 'en'])).toBeNull();
    expect(languageHeaderMismatch('de-DE,de;q=0.9', ['en-GB'])).toBe('languageHeaderMismatch');
    expect(languageHeaderMismatch('en', ['en-GB'])).toBeNull();
    expect(languageHeaderMismatch(null, ['en'])).toBeNull();
    expect(languageHeaderMismatch('*', ['ar'])).toBeNull();
    const r = run({ headers: { userAgent: TEST_USER_AGENT, secChUa: null, secChUaPlatform: null, acceptLanguage: 'ru-RU,ru' } });
    expect(r.antiDetect.details.reasons).toEqual(['languageHeaderMismatch']);
  });
});

describe('headless tells', () => {
  it('counts an 800x600 desktop screen and a 0 ms round trip as weak indicators', () => {
    const payload = makePayload({ attributes: { screenWidth: 800, screenHeight: 600 } });
    expect(run({ payload }).bot.details).toMatchObject({ headlessScreen: true, weakIndicatorCount: 1 });
    const env = {
      engine: 'blink' as const, uaPlatformVersion: null, uaArchitecture: null, uaBitness: null, uaModel: null,
      uaFullVersion: null, timerResolutionMs: 0.1, permissions: null, cdp: false, multiScreen: null, gpc: null,
      doNotTrack: false, connectionRtt: 0,
    };
    const both = run({ payload: { ...payload, env } }).bot;
    expect(both).toMatchObject({ detected: true, details: { zeroRtt: true, weakIndicatorCount: 2 } });
  });
});
