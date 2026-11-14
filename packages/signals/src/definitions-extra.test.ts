import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';

const cfg = TEST_SCORING_CONFIG;
const run = (overrides: Parameters<typeof makePayload>[0]) =>
  evaluateSignals(makeContext({ payload: makePayload(overrides) }), cfg);

describe('devtools', () => {
  it('follows the client heuristic and tolerates older payloads without it', () => {
    const payload = makePayload();
    expect(evaluateSignals(makeContext({ payload }), cfg).devtools).toEqual({
      detected: false,
      details: { method: null, reported: false },
    });
    const withDevtools = { ...payload, devtools: { likely: true, method: 'windowSize' } };
    expect(evaluateSignals(makeContext({ payload: withDevtools }), cfg).devtools.detected).toBe(true);
  });
});

describe('virtualMachine', () => {
  it.each([
    'ANGLE (VMware, Inc., VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'VirtualBox Graphics Adapter',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'Microsoft Basic Render Driver',
    'virgl',
  ])('flags %s', (renderer) => {
    expect(run({ attributes: { webglRenderer: renderer } }).virtualMachine.detected).toBe(true);
  });

  it('does not flag real GPUs or a missing renderer', () => {
    expect(run({ attributes: { webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)' } }).virtualMachine.detected).toBe(false);
    expect(run({ attributes: { webglRenderer: 'Apple M2' } }).virtualMachine.detected).toBe(false);
    expect(run({ attributes: { webglRenderer: null } }).virtualMachine.detected).toBe(false);
  });
});

describe('privacyBrowser', () => {
  it('detects Brave, canvas farbling, DuckDuckGo and Tor/Mullvad-like Firefox', () => {
    expect(run({ privacy: { braveLikely: true } }).privacyBrowser.details.reasons).toEqual(['brave']);
    expect(run({ tamper: { canvasNoise: true } }).privacyBrowser.details.reasons).toEqual(['canvasNoise']);
    expect(
      run({ attributes: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile DuckDuckGo/5' } })
        .privacyBrowser.detected,
    ).toBe(true);
    const tor = run({
      attributes: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
        timezone: 'UTC',
        availWidth: 1400,
        availHeight: 900,
      },
    });
    expect(tor.privacyBrowser.details.reasons).toEqual(['torOrMullvad']);
  });

  it('does not flag ordinary Firefox in UTC without letterboxing', () => {
    const r = run({
      attributes: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:132.0) Gecko/20100101 Firefox/132.0',
        timezone: 'UTC',
        availWidth: 1920,
        availHeight: 1040,
      },
    });
    expect(r.privacyBrowser.detected).toBe(false);
  });
});

describe('highActivity', () => {
  const velocity = (eventsPerVisitor24h: number | null) => ({
    eventsPerVisitor1h: 1,
    eventsPerVisitor24h,
    visitorsPerIp1h: 1,
    ipsPerVisitor24h: 1,
    visitorsPerLinkedId24h: null,
  });

  it('fires above the daily threshold and reports unavailable counters', () => {
    expect(evaluateSignals(makeContext({ velocity: velocity(501) }), cfg).highActivity.detected).toBe(true);
    expect(evaluateSignals(makeContext({ velocity: velocity(500) }), cfg).highActivity.detected).toBe(false);
    expect(evaluateSignals(makeContext({ velocity: velocity(null) }), cfg).highActivity.details.available).toBe(false);
  });
});
