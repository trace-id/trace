import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CROSS_BROWSER_CONFIG as CFG,
  clockBucket,
  gpuKind,
  linkConfidence,
  maskSimilarity,
  networkFactor,
  normalizeGpu,
  profileSimilarity,
  readDeviceProfile,
} from './crossbrowser.js';
import { makePayload } from './testing.js';
import { type SignalPayload } from './types.js';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/131.0.0.0`;
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

function browserPayload(ua: string, renderer: string, overrides: Partial<SignalPayload['attributes']> = {}): SignalPayload {
  const base = makePayload();
  return {
    ...base,
    // Engine-specific readings differ between browsers on one machine.
    components: { ...base.components, canvas: ua.slice(-20).padEnd(28, '0'), fonts: 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0' },
    attributes: {
      ...base.attributes,
      userAgent: ua,
      platform: 'Win32',
      webglRenderer: renderer,
      screenWidth: 1920,
      screenHeight: 1080,
      colorDepth: 24,
      hardwareConcurrency: 16,
      maxTouchPoints: 0,
      timezone: 'Africa/Cairo',
      languages: ['en-US', 'en'],
      ...overrides,
    },
    device: { voices: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa', displayPrefs: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  };
}

describe('normalizeGpu', () => {
  it('reduces Chrome ANGLE strings and plain strings to the same vendor and model', () => {
    expect(normalizeGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({
      vendor: 'nvidia',
      model: '3060',
    });
    expect(normalizeGpu('NVIDIA GeForce RTX 3060/PCIe/SSE2')).toEqual({ vendor: 'nvidia', model: '3060' });
    expect(normalizeGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({
      vendor: 'intel',
      model: '620',
    });
    expect(normalizeGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toEqual({
      vendor: 'apple',
      model: 'm1',
    });
    expect(normalizeGpu('Apple M1')).toEqual({ vendor: 'apple', model: 'm1' });
    expect(normalizeGpu('AMD Radeon RX 6700 XT')).toEqual({ vendor: 'amd', model: '6700' });
  });

  it('keeps only the vendor when the browser hides the model', () => {
    expect(normalizeGpu('ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar')).toEqual({
      vendor: 'nvidia',
      model: null,
    });
    expect(normalizeGpu('Apple GPU')).toEqual({ vendor: 'apple', model: null });
  });

  it('returns null for nothing useful', () => {
    expect(normalizeGpu(null)).toBeNull();
    expect(normalizeGpu('')).toBeNull();
  });
});

describe('cross-browser similarity', () => {
  const chrome = readDeviceProfile(
    browserPayload(CHROME_WIN, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
  );

  it('matches Chrome and Edge on the same machine fully', () => {
    const edge = readDeviceProfile(
      browserPayload(EDGE_WIN, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    );
    expect(edge.browser).toBe('edge');
    expect(chrome.browser).toBe('chrome');
    expect(profileSimilarity(chrome.profile, edge.profile, CFG)).toBe(1);
    expect(edge.coreHash).toBe(chrome.coreHash);
  });

  it('matches Firefox (sanitized GPU, different voices) above the link threshold', () => {
    const firefox = readDeviceProfile(
      {
        ...browserPayload(FIREFOX_WIN, 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar'),
        device: { voices: 'cccccccccccccccccccccccccccc', displayPrefs: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      },
    );
    expect(firefox.profile.gpu).toBeUndefined();
    const similarity = profileSimilarity(chrome.profile, firefox.profile, CFG);
    expect(similarity).toBeGreaterThanOrEqual(CFG.linkThreshold);
    expect(similarity).toBeLessThan(1);
  });

  it('never matches when a required trait differs', () => {
    const otherGpu = readDeviceProfile(browserPayload(EDGE_WIN, 'NVIDIA GeForce RTX 4090'));
    const otherScreen = readDeviceProfile(
      browserPayload(EDGE_WIN, 'NVIDIA GeForce RTX 3060', { screenWidth: 2560, screenHeight: 1440 }),
    );
    const otherOs = readDeviceProfile(
      browserPayload(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'NVIDIA GeForce RTX 3060',
        { platform: 'Linux x86_64' },
      ),
    );
    expect(profileSimilarity(chrome.profile, otherGpu.profile, CFG)).toBe(0);
    expect(profileSimilarity(chrome.profile, otherScreen.profile, CFG)).toBe(0);
    expect(profileSimilarity(chrome.profile, otherOs.profile, CFG)).toBe(0);
  });

  it('treats a rotated screen as the same screen', () => {
    const rotated = readDeviceProfile(browserPayload(EDGE_WIN, 'NVIDIA GeForce RTX 3060', { screenWidth: 1080, screenHeight: 1920 }));
    expect(rotated.profile.screen).toBe(chrome.profile.screen);
  });

  it('links a dual-GPU laptop where Chrome got the NVIDIA and Edge the integrated AMD', () => {
    const dgpu = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Ti Laptop GPU (0x000025A0) Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const igpu = 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)';
    expect(gpuKind(normalizeGpu(dgpu))).toBe('d');
    expect(gpuKind(normalizeGpu(igpu))).toBe('i');
    const onChrome = readDeviceProfile(browserPayload(CHROME_WIN, dgpu));
    const onEdge = readDeviceProfile(browserPayload(EDGE_WIN, igpu));
    expect(profileSimilarity(onChrome.profile, onEdge.profile, CFG)).toBe(1);
  });

  it('still separates two machines with different discrete GPUs', () => {
    const a = readDeviceProfile(browserPayload(CHROME_WIN, 'NVIDIA GeForce RTX 3050 Ti Laptop GPU'));
    const b = readDeviceProfile(browserPayload(EDGE_WIN, 'AMD Radeon RX 6700 XT'));
    expect(profileSimilarity(a.profile, b.profile, CFG)).toBe(0);
  });

  it('gives partial credit when one font measures differently', () => {
    const withMask = (mask: string) => {
      const p = browserPayload(EDGE_WIN, 'NVIDIA GeForce RTX 3060');
      return readDeviceProfile({ ...p, components: { ...p.components, fonts: mask.padEnd(28, '0') }, device: { ...p.device, fontsMask: mask } });
    };
    const a = withMask('ffffffffffff0f0');
    const b = withMask('ffffffffffff0f1');
    expect(maskSimilarity('ffffffffffff0f0', 'ffffffffffff0f1')).toBeCloseTo(52 / 53);
    const similarity = profileSimilarity(a.profile, b.profile, CFG);
    expect(similarity).toBeGreaterThan(0.99);
    expect(similarity).toBeLessThan(1);
  });

  it('refuses to compare sparse profiles', () => {
    expect(profileSimilarity({ os: 'x' }, { os: 'x' }, CFG)).toBe(0);
  });
});

describe('network strength', () => {
  it('trusts small networks fully and busy ones less', () => {
    expect(networkFactor(2, 1, CFG)).toBe(1);
    expect(networkFactor(15, 1, CFG)).toBe(0.95);
    expect(networkFactor(80, 1, CFG)).toBe(0.85);
    expect(networkFactor(5000, 1, CFG)).toBe(0.75);
  });

  it('trusts two or more shared networks fully, however busy', () => {
    expect(networkFactor(5000, 2, CFG)).toBe(1);
  });

  it('scales similarity by the network factor', () => {
    expect(linkConfidence(0.9, 0.85)).toBe(0.77);
    expect(linkConfidence(1, 0)).toBe(0);
  });
});

describe('clock offset', () => {
  const base = readDeviceProfile(browserPayload(CHROME_WIN, 'NVIDIA GeForce RTX 3060')).profile;
  const withClock = (clockMs: number | undefined) => ({ ...base, ...(clockMs === undefined ? {} : { clockMs }) });

  it('buckets synced clocks to 0 and keeps real offsets', () => {
    expect(clockBucket(350)).toBe(0);
    expect(clockBucket(-1999)).toBe(0);
    expect(clockBucket(73_456)).toBe(73_500);
    expect(clockBucket(null)).toBeUndefined();
  });

  it('ignores two synced clocks, matches equal offsets and penalises a mismatch', () => {
    expect(profileSimilarity(withClock(0), withClock(0), CFG)).toBe(1);
    expect(profileSimilarity(withClock(73_500), withClock(74_200), CFG)).toBe(1);
    expect(profileSimilarity(withClock(73_500), withClock(0), CFG)).toBeLessThan(1);
    expect(profileSimilarity(withClock(73_500), withClock(-40_000), CFG)).toBeLessThan(1);
    expect(profileSimilarity(withClock(73_500), withClock(undefined), CFG)).toBe(1);
  });
});
