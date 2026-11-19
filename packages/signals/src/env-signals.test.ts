import { describe, expect, it } from 'vitest';
import { engineMismatch, uaVersionMismatch } from './antidetect.js';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT, makeContext, makePayload } from './testing.js';
import { type EnvironmentExtras } from './types.js';

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';

const ENV: EnvironmentExtras = {
  engine: 'blink',
  uaPlatformVersion: '15.0.0',
  uaArchitecture: 'x86',
  uaBitness: '64',
  uaModel: null,
  uaFullVersion: '130.0.6723.92',
  timerResolutionMs: 0.1,
  permissions: 'ppppppp',
  cdp: false,
  multiScreen: false,
  gpc: null,
  doNotTrack: false,
};
const run = (env: Partial<EnvironmentExtras>, attrs: Parameters<typeof makePayload>[0] = {}, extra = {}) =>
  evaluateSignals(makeContext({ payload: { ...makePayload(attrs), env: { ...ENV, ...env }, ...extra } }), TEST_SCORING_CONFIG);

describe('engine and version checks', () => {
  it('compares the claimed browser with the engine that runs the page', () => {
    expect(engineMismatch(ENV, TEST_USER_AGENT)).toBeNull();
    expect(engineMismatch({ ...ENV, engine: 'blink' }, FIREFOX)).toBe('engineMismatch');
    expect(engineMismatch({ ...ENV, engine: 'gecko' }, FIREFOX)).toBeNull();
    expect(engineMismatch({ ...ENV, engine: 'webkit' }, IOS_CHROME)).toBeNull(); // every iOS browser is WebKit
    expect(engineMismatch({ ...ENV, engine: 'unknown' }, FIREFOX)).toBeNull();
    expect(engineMismatch(undefined, FIREFOX)).toBeNull();
  });

  it('compares the user agent version with the client-hints version', () => {
    expect(uaVersionMismatch(ENV, TEST_USER_AGENT)).toBeNull();
    expect(uaVersionMismatch({ ...ENV, uaFullVersion: '124.0.6367.60' }, TEST_USER_AGENT)).toBe('uaVersionMismatch');
    expect(uaVersionMismatch({ ...ENV, uaFullVersion: null }, TEST_USER_AGENT)).toBeNull();
    expect(uaVersionMismatch(ENV, FIREFOX)).toBeNull();
  });

  it('feeds antiDetect and the anomaly score', () => {
    const r = run({ engine: 'gecko' });
    expect(r.antiDetect.details.reasons).toEqual(['engineMismatch']);
    expect(r.tampering.details.anomalyScore).toBe(0.6);
    expect(run({}).antiDetect.detected).toBe(false);
  });
});

describe('bot extras', () => {
  it('counts a DevTools-protocol read as weak, and ignores it when DevTools is visibly open', () => {
    expect(run({ cdp: true }).bot.details).toMatchObject({ devtoolsProtocol: true, weakIndicatorCount: 1 });
    expect(run({ cdp: true }, {}, { devtools: { likely: true, method: 'windowSize' } }).bot.details.devtoolsProtocol).toBe(false);
    expect(run({ cdp: true }, { bot: { noPlugins: true } }).bot.detected).toBe(true);
  });

  it('treats a HeadlessChrome client-hints brand as headless', () => {
    const r = run({}, { attributes: { uaBrands: [{ brand: 'HeadlessChrome', version: '130' }] } });
    expect(r.bot).toMatchObject({ detected: true, details: { headlessBrand: true } });
  });
});

describe('coarse timer', () => {
  it('marks Tor-style timer precision as a privacy browser', () => {
    expect(run({ timerResolutionMs: 100 }).privacyBrowser.details.reasons).toEqual(['coarseTimer']);
    expect(run({ timerResolutionMs: 1 }).privacyBrowser.detected).toBe(false);
  });
});
