import { describe, expect, it } from 'vitest';
import { browserFamily, osFamily, platformFamily, platformsCompatible } from './ua.js';

const UAS = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

describe('ua parsing', () => {
  it('classifies browser families', () => {
    expect(browserFamily(UAS.chromeWin)).toBe('chrome');
    expect(browserFamily(UAS.edge)).toBe('edge');
    expect(browserFamily(UAS.safariMac)).toBe('safari');
    expect(browserFamily(UAS.firefoxLinux)).toBe('firefox');
  });

  it('classifies OS families', () => {
    expect(osFamily(UAS.chromeWin)).toBe('windows');
    expect(osFamily(UAS.iphone)).toBe('ios');
    expect(osFamily(UAS.android)).toBe('android');
    expect(osFamily(UAS.firefoxLinux)).toBe('linux');
  });

  it('accepts known platform quirks and rejects real mismatches', () => {
    expect(platformsCompatible(osFamily(UAS.android), platformFamily('Linux armv8l'))).toBe(true);
    expect(platformsCompatible(osFamily(UAS.iphone), platformFamily('MacIntel'))).toBe(true);
    expect(platformsCompatible(osFamily(UAS.chromeWin), platformFamily('MacIntel'))).toBe(false);
  });
});
