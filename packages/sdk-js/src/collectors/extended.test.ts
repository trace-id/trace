import { describe, expect, it, vi } from 'vitest';
import {
  detectEngine,
  gpuCapabilities,
  readApiSurface,
  readCdp,
  readHighEntropy,
  readIntl,
  readPermissions,
  readTimerResolution,
} from './extended.js';

describe('extended collectors', () => {
  it('detects the engine running the tests (V8 under Node)', () => {
    expect(detectEngine()).toBe('blink');
  });

  it('reads locale formatting and API presence without throwing', () => {
    expect(readIntl()).toMatch(/\|/);
    const surface = readApiSurface();
    expect(surface).toMatch(/^[01]+\|[01]+\|/);
  });

  it('measures a positive timer step', () => {
    const r = readTimerResolution();
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
  });

  it('reads client hints when the browser offers them, and nothing otherwise', async () => {
    expect(await readHighEntropy(100)).toEqual({});
    const getHighEntropyValues = vi.fn(async () => ({
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      fullVersionList: [
        { brand: 'Not)A;Brand', version: '99.0.0.0' },
        { brand: 'Chromium', version: '130.0.6723.92' },
      ],
    }));
    vi.stubGlobal('navigator', { ...navigator, userAgentData: { getHighEntropyValues } });
    try {
      expect(await readHighEntropy(100)).toEqual({
        uaPlatformVersion: '15.0.0',
        uaArchitecture: 'x86',
        uaBitness: '64',
        uaModel: null,
        uaFullVersion: '130.0.6723.92',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('encodes permission states as letters and never prompts', async () => {
    const query = vi.fn(async ({ name }: { name: string }) => ({ state: name === 'notifications' ? 'denied' : 'prompt' }));
    vi.stubGlobal('navigator', { ...navigator, permissions: { query } });
    try {
      expect(await readPermissions(100)).toBe('dpppppp');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('notices when something reads a logged error (as DevTools-protocol automation does)', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation((e: unknown) => void (e as Error).stack);
    expect(readCdp()).toBe(true);
    spy.mockImplementation(() => undefined);
    expect(readCdp()).toBe(false);
    spy.mockRestore();
  });

  it('summarises WebGPU capabilities', () => {
    expect(gpuCapabilities(null)).toBeNull();
    expect(gpuCapabilities({ features: ['timestamp-query', 'float32-filterable'], limits: { maxTextureDimension2D: 16384, maxBindGroups: 4 } })).toBe(
      'float32-filterable,timestamp-query|16384,,,,,4,',
    );
  });
});
