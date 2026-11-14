import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { CLEAN_IP, TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';

const cfg = TEST_SCORING_CONFIG;

describe('signal definitions', () => {
  it('detects nothing on a clean context', () => {
    const r = evaluateSignals(makeContext(), cfg);
    expect(Object.values(r).filter((s) => s.detected)).toEqual([]);
  });

  describe('bot', () => {
    it('fires on a single strong indicator', () => {
      for (const bot of [{ webdriver: true }, { headlessUserAgent: true }, { automationGlobals: ['__playwright'] }]) {
        expect(evaluateSignals(makeContext({ payload: makePayload({ bot }) }), cfg).bot.detected).toBe(true);
      }
    });

    it('needs two weak indicators', () => {
      const one = makeContext({ payload: makePayload({ bot: { noPlugins: true } }) });
      const two = makeContext({ payload: makePayload({ bot: { noPlugins: true, zeroOuterSize: true } }) });
      expect(evaluateSignals(one, cfg).bot.detected).toBe(false);
      expect(evaluateSignals(two, cfg).bot.detected).toBe(true);
    });

    it('fires when the UA header differs from the UA the page reported', () => {
      const ctx = makeContext({ headers: { userAgent: 'curl/8.0', secChUa: null, secChUaPlatform: null } });
      const r = evaluateSignals(ctx, cfg).bot;
      expect(r.detected).toBe(true);
      expect(r.details.userAgentHeaderMismatch).toBe(true);
    });

    it('does not treat a missing UA header as a mismatch', () => {
      const ctx = makeContext({ headers: { userAgent: null, secChUa: null, secChUaPlatform: null } });
      expect(evaluateSignals(ctx, cfg).bot.detected).toBe(false);
    });
  });

  describe('tampering', () => {
    it('fires on overridden natives, shadowed navigator props and UA mismatches', () => {
      for (const tamper of [
        { nativeOverrides: ['HTMLCanvasElement.toDataURL'] },
        { navigatorOwnProperties: ['userAgent'] },
        { uaPlatformMismatch: true },
        { uaFeatureMismatch: true },
      ]) {
        expect(evaluateSignals(makeContext({ payload: makePayload({ tamper }) }), cfg).tampering.detected).toBe(true);
      }
    });

    it('reports canvas noise without flagging it alone', () => {
      const r = evaluateSignals(makeContext({ payload: makePayload({ tamper: { canvasNoise: true } }) }), cfg).tampering;
      expect(r.detected).toBe(false);
      expect(r.details.canvasNoise).toBe(true);
    });
  });

  it('maps IP intel to tor, datacenterIp and ipBlocklist', () => {
    const r = evaluateSignals(makeContext({ ip: { ...CLEAN_IP, tor: true, datacenter: true, blocklisted: true } }), cfg);
    expect([r.tor.detected, r.datacenterIp.detected, r.ipBlocklist.detected]).toEqual([true, true, true]);
  });

  describe('velocity', () => {
    it('is not detected when counters are unavailable', () => {
      const r = evaluateSignals(makeContext({ velocity: null }), cfg).velocity;
      expect(r.detected).toBe(false);
      expect(r.details.available).toBe(false);
    });

    it('lists each threshold exceeded', () => {
      const r = evaluateSignals(
        makeContext({
          velocity: {
            eventsPerVisitor1h: 61,
            eventsPerVisitor24h: 61,
            visitorsPerIp1h: 20,
            ipsPerVisitor24h: 11,
            visitorsPerLinkedId24h: null,
          },
        }),
        cfg,
      ).velocity;
      expect(r.detected).toBe(true);
      expect(r.details.exceeded).toEqual(['eventsPerVisitor1h', 'ipsPerVisitor24h']);
    });
  });

  it('passes through the incognito heuristic', () => {
    const payload = makePayload({ privacy: { incognitoLikely: true, incognitoMethod: 'quota' } });
    const r = evaluateSignals(makeContext({ payload }), cfg).incognito;
    expect(r).toEqual({ detected: true, details: { method: 'quota' } });
  });
});
