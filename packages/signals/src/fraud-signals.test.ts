import { describe, expect, it } from 'vitest';
import { clientHintsMismatch, fontOsMismatch, gpuOsMismatch } from './antidetect.js';
import { evaluateSignals } from './definitions.js';
import { FONT_CANDIDATES, fontsFromMask, fontsMask } from './fonts.js';
import { CLEAN_IP, TEST_SCORING_CONFIG, TEST_USER_AGENT, makeContext, makePayload } from './testing.js';
import { checkTimezoneCountry, timezonesForCountry } from './timezones.js';
import { parseJa4, tlsMismatchReasons } from './tls.js';
import { timezoneOffsetMinutes } from './tzoffset.js';
import { type ConsistencyIndicators, type EvaluationContext } from './types.js';

const cfg = TEST_SCORING_CONFIG;
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const eval_ = (ctx: Partial<EvaluationContext>) => evaluateSignals(makeContext(ctx), cfg);
const CLEAN: ConsistencyIndicators = { workerMismatch: [], iframeMismatch: [], timezoneOffsetMismatch: false };

describe('fonts mask', () => {
  it('round-trips', () => {
    const fonts = ['Calibri', 'Menlo', 'Nirmala UI'];
    expect(fontsFromMask(fontsMask(fonts))).toEqual(['Calibri', 'Menlo', 'Nirmala UI']);
    expect(fontsFromMask(fontsMask([...FONT_CANDIDATES]))).toEqual([...FONT_CANDIDATES]);
    expect(fontsFromMask('zz')).toEqual([]);
  });
});

describe('gpuOsMismatch', () => {
  it.each([
    [TEST_USER_AGENT, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'appleGpuOnNonApple'],
    [MAC_UA, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'direct3dOnNonWindows'],
    [TEST_USER_AGENT, 'Mali-G78', 'mobileGpuOnDesktop'],
    [ANDROID_UA, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'direct3dOnNonWindows'],
    [ANDROID_UA, 'NVIDIA GeForce RTX 3060/PCIe/SSE2', 'desktopGpuOnMobile'],
  ])('%#: flags a GPU from another OS', (ua, renderer, reason) => {
    expect(gpuOsMismatch(ua, renderer)).toBe(reason);
  });

  it.each([
    [TEST_USER_AGENT, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    [TEST_USER_AGENT, 'ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    [MAC_UA, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
    [MAC_UA, 'Apple M1, or similar'],
    [ANDROID_UA, 'Adreno (TM) 740'],
    [ANDROID_UA, 'Mali-G78'],
    [null, 'Apple M2'],
  ])('%#: accepts a GPU that fits', (ua, renderer) => {
    expect(gpuOsMismatch(ua, renderer)).toBeNull();
  });
});

describe('fontOsMismatch', () => {
  it('needs two OS-only fonts of another system', () => {
    expect(fontOsMismatch(TEST_USER_AGENT, fontsMask(['Apple Color Emoji', 'Menlo']))).toBe('macFontsOnWindows');
    expect(fontOsMismatch(TEST_USER_AGENT, fontsMask(['Menlo', 'Calibri']))).toBeNull();
    expect(fontOsMismatch(MAC_UA, fontsMask(['Segoe UI Emoji', 'Bahnschrift']))).toBe('windowsFontsOnMac');
    // Office for Mac installs Windows fonts such as Calibri and Segoe Print; those do not count.
    expect(fontOsMismatch(MAC_UA, fontsMask(['Calibri', 'Cambria', 'Segoe Print', 'MS Gothic']))).toBeNull();
    expect(fontOsMismatch(ANDROID_UA, fontsMask(['Segoe UI Emoji', 'Bahnschrift']))).toBeNull();
  });
});

describe('antiDetect', () => {
  it('is quiet for a consistent browser and for older payloads', () => {
    expect(eval_({}).antiDetect.detected).toBe(false);
    const payload = { ...makePayload(), consistency: CLEAN };
    expect(eval_({ payload }).antiDetect).toEqual({
      detected: false,
      details: { reasons: [], workerMismatch: [], iframeMismatch: [], workerChecked: true },
    });
  });

  it('flags worker, iframe and clock contradictions', () => {
    const payload = {
      ...makePayload(),
      consistency: { workerMismatch: ['userAgent'], iframeMismatch: ['languages'], timezoneOffsetMismatch: true },
    };
    expect(eval_({ payload }).antiDetect.details.reasons).toEqual([
      'workerMismatch',
      'iframeMismatch',
      'timezoneOffsetMismatch',
    ]);
  });

  it('ignores the CPU count Brave randomises, but not for other browsers', () => {
    const consistency = { ...CLEAN, workerMismatch: ['hardwareConcurrency'] };
    const brave = { ...makePayload({ privacy: { braveLikely: true } }), consistency };
    expect(eval_({ payload: brave }).antiDetect.detected).toBe(false);
    expect(eval_({ payload: { ...makePayload(), consistency } }).antiDetect.detected).toBe(true);
  });

  it('flags a GPU or fonts from another OS', () => {
    const gpu = makePayload({ attributes: { webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' } });
    expect(eval_({ payload: gpu }).antiDetect.details.reasons).toEqual(['appleGpuOnNonApple']);
    const fonts = { ...makePayload(), device: { fontsMask: fontsMask(['Apple Color Emoji', 'PingFang SC', 'Calibri']) } };
    expect(eval_({ payload: fonts }).antiDetect.details.reasons).toEqual(['macFontsOnWindows']);
  });
});

describe('time zones', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');

  it('computes offsets with daylight saving', () => {
    expect(timezoneOffsetMinutes('Europe/Berlin', winter)).toBe(60);
    expect(timezoneOffsetMinutes('Europe/Berlin', summer)).toBe(120);
    expect(timezoneOffsetMinutes('Asia/Kolkata', summer)).toBe(330);
    expect(timezoneOffsetMinutes('America/New_York', winter)).toBe(-300);
    expect(timezoneOffsetMinutes('Not/AZone', winter)).toBeNull();
  });

  it('matches by offset, so coarse and legacy zone names still fit', () => {
    expect(checkTimezoneCountry('Europe/Berlin', 'NL', summer).status).toBe('match');
    expect(checkTimezoneCountry('Asia/Calcutta', 'IN', summer).status).toBe('match');
    expect(checkTimezoneCountry('America/Chicago', 'US', winter).status).toBe('match');
    expect(checkTimezoneCountry('Africa/Cairo', 'EG', summer).status).toBe('match');
    expect(checkTimezoneCountry('Asia/Riyadh', 'SA', summer).status).toBe('match');
  });

  it('reports a mismatch with the offsets compared', () => {
    expect(checkTimezoneCountry('Africa/Cairo', 'US', winter)).toEqual({
      status: 'mismatch',
      offsetMinutes: 120,
      countryOffsets: [-600, -540, -480, -420, -360, -300],
    });
  });

  it('does not judge without a country, a zone, or with a location-less zone', () => {
    expect(checkTimezoneCountry('Europe/Berlin', null, winter)).toEqual({ status: 'unknown', reason: 'noCountry' });
    expect(checkTimezoneCountry(null, 'DE', winter)).toEqual({ status: 'unknown', reason: 'noTimezone' });
    expect(checkTimezoneCountry('UTC', 'DE', winter)).toEqual({ status: 'unknown', reason: 'locationless' });
    expect(checkTimezoneCountry('Etc/GMT-3', 'DE', winter)).toEqual({ status: 'unknown', reason: 'locationless' });
    expect(checkTimezoneCountry('Europe/Berlin', 'XX', winter)).toEqual({ status: 'unknown', reason: 'unknownCountry' });
    expect(timezonesForCountry('us').length).toBeGreaterThan(20);
  });
});

describe('vpn', () => {
  const now = new Date('2026-01-15T12:00:00Z');
  it('fires when the IP country has no zone at the device offset', () => {
    const r = eval_({ ip: { ...CLEAN_IP, country: 'US' }, now }).vpn; // test payload is Europe/Berlin
    expect(r).toEqual({
      detected: true,
      details: {
        available: true,
        methods: ['timezoneMismatch'],
        relay: false,
        ipCountry: 'US',
        timezone: 'Europe/Berlin',
        timezoneCheck: 'mismatch',
        deviceOffset: '+01:00',
        countryOffsets: ['-10:00', '-09:00', '-08:00', '-07:00', '-06:00', '-05:00'],
      },
    });
    expect(eval_({ ip: { ...CLEAN_IP, country: 'FR' }, now }).vpn.detected).toBe(false);
  });

  it('fires on a listed VPN range and reports relays without firing', () => {
    expect(eval_({ ip: { ...CLEAN_IP, vpn: true }, now }).vpn.details).toMatchObject({ available: true, methods: ['publicVpn'] });
    const relay = eval_({ ip: { ...CLEAN_IP, country: 'DE', relay: true, vpn: false }, now }).vpn;
    expect(relay).toMatchObject({ detected: false, details: { relay: true, methods: [] } });
  });

  it('is unavailable without GeoIP or lists', () => {
    expect(eval_({ now }).vpn.details).toMatchObject({ available: false, timezoneCheck: 'noCountry' });
  });
});

describe('client hints and anomaly score', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  it('flags a user agent the network stack contradicts', () => {
    expect(clientHintsMismatch('"Windows"', MAC)).toBe('clientHintsMismatch');
    expect(clientHintsMismatch('"macOS"', MAC)).toBeNull();
    expect(clientHintsMismatch('"Linux"', ANDROID_UA)).toBeNull();
    expect(clientHintsMismatch(null, MAC)).toBeNull();
    const ctx = { payload: makePayload({ attributes: { userAgent: MAC } }), headers: { userAgent: MAC, secChUa: null, secChUaPlatform: '"Windows"' } };
    expect(eval_(ctx).antiDetect.details.reasons).toContain('clientHintsMismatch');
  });

  it('scores 0 for a clean browser and grows with each finding, never past 1', () => {
    expect(eval_({}).tampering.details.anomalyScore).toBe(0);
    const one = eval_({ payload: makePayload({ tamper: { uaPlatformMismatch: true } }) }).tampering.details.anomalyScore;
    expect(one).toBe(0.4);
    const many = {
      ...makePayload({ tamper: { nativeOverrides: ['a', 'b', 'c', 'd'], navigatorOwnProperties: ['userAgent'], uaPlatformMismatch: true, uaFeatureMismatch: true } }),
      consistency: { workerMismatch: ['userAgent'], iframeMismatch: ['platform'], timezoneOffsetMismatch: true },
    };
    const score = eval_({ payload: many }).tampering.details.anomalyScore as number;
    expect(score).toBeGreaterThan(0.95);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('velocity extras', () => {
  it('flags bursts, many countries and many accounts per browser', () => {
    const base = { eventsPerVisitor1h: 1, eventsPerVisitor24h: 1, visitorsPerIp1h: 1, ipsPerVisitor24h: 1, visitorsPerLinkedId24h: null };
    const r = eval_({ velocity: { ...base, eventsPerVisitor5m: 21, countriesPerVisitor24h: 3, linkedIdsPerVisitor24h: 4 } }).velocity;
    expect(r.detected).toBe(true);
    expect(r.details.exceeded).toEqual(['eventsPerVisitor5m', 'countriesPerVisitor24h', 'linkedIdsPerVisitor24h']);
    expect(eval_({ velocity: base }).velocity.detected).toBe(false);
  });
});

describe('tlsMismatch', () => {
  const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
  it('parses JA4', () => {
    expect(parseJa4(CHROME_JA4)).toEqual({ protocol: 't', version: '13', sni: true, ciphers: 15, extensions: 16, alpn: 'h2' });
    expect(parseJa4('nonsense')).toBeNull();
  });

  it('flags handshakes no current browser makes, only for browser user agents', () => {
    expect(tlsMismatchReasons(CHROME_JA4, TEST_USER_AGENT, false)).toEqual([]);
    expect(tlsMismatchReasons('q13d0312h3_55b375c5d22e_06cda9e17597', TEST_USER_AGENT, false)).toEqual([]);
    expect(tlsMismatchReasons('t12i3006h1_a0f71150db8b_0f1ae3f26b6c', TEST_USER_AGENT, false)).toEqual([
      'oldTlsVersion',
      'noSni',
      'http1Only',
    ]);
    expect(tlsMismatchReasons('t13d311000_e8f1e7e78f70_d41ae481755e', TEST_USER_AGENT, false)).toEqual(['noAlpn']);
    expect(tlsMismatchReasons('t13d311000_e8f1e7e78f70_d41ae481755e', 'python-requests/2.32', false)).toEqual([]);
    expect(tlsMismatchReasons(CHROME_JA4, 'python-requests/2.32', true)).toEqual(['blocklisted']);
  });

  it('is unavailable without a fingerprint, and reports reasons otherwise', () => {
    expect(eval_({}).tlsMismatch.details).toEqual({ available: false });
    const r = eval_({ tls: { ja4: 't13d311000_e8f1e7e78f70_d41ae481755e', blocklisted: false } }).tlsMismatch;
    expect(r).toEqual({ detected: true, details: { available: true, ja4: 't13d311000_e8f1e7e78f70_d41ae481755e', reasons: ['noAlpn'] } });
  });
});

describe('multiAccount / accountSharing', () => {
  it('compares against the configured limits', () => {
    expect(eval_({}).multiAccount.details).toEqual({ available: false });
    expect(eval_({}).accountSharing.details).toEqual({ available: false });
    const many = eval_({ accounts: { accountsOnDevice: 3, devicesForAccount: 6 } });
    expect(many.multiAccount.detected).toBe(true);
    expect(many.accountSharing.detected).toBe(true);
    const few = eval_({ accounts: { accountsOnDevice: 2, devicesForAccount: null } });
    expect(few.multiAccount.detected).toBe(false);
    expect(few.accountSharing.details).toEqual({ available: false });
  });
});
