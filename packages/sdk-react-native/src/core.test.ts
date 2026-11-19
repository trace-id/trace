// @vitest-environment node
import { checkPayloadIntegrity } from '@trace-id/signals/integrity';
import { describe, expect, it } from 'vitest';
import { buildPayload, type NativeReadings, toHex } from './core.js';

export const READINGS: NativeReadings = {
  platform: 'ios',
  osVersion: '18.1',
  manufacturer: 'Apple',
  model: 'iPhone 15',
  screen: { width: 393, height: 852, scale: 3 },
  totalMemoryBytes: 6 * 1024 ** 3,
  timezone: 'Africa/Cairo',
  languages: ['ar-EG', 'en-US'],
  appId: 'com.example.shop',
  appVersion: '2.4.0',
  buildVersion: '240',
  isDevice: true,
  rooted: false,
  installedAt: 1_760_000_000_000,
  installIdHash: 'ab'.repeat(32),
};

describe('buildPayload', () => {
  it('reports the app and device, with neutral browser sections', () => {
    const p = buildPayload(READINGS, 12);
    expect(p.app).toEqual({
      platform: 'ios',
      osVersion: '18.1',
      manufacturer: 'Apple',
      model: 'iPhone 15',
      appId: 'com.example.shop',
      appVersion: '2.4.0',
      buildVersion: '240',
      isDevice: true,
      rooted: false,
      installedAt: 1_760_000_000_000,
    });
    expect(p.attributes).toMatchObject({ screenWidth: 393, screenHeight: 852, pixelRatio: 3, deviceMemory: 6, platform: 'iOS', userAgent: null, webglRenderer: null });
    expect(p.bot.webdriver).toBe(false);
    expect(p.collectMs).toBe(12);
  });

  it('derives components the way the server checks them, so an untouched app is not "tampered"', () => {
    const p = buildPayload(READINGS);
    expect(checkPayloadIntegrity(p).mismatched).toEqual([]);
    expect(checkPayloadIntegrity(p).checked).toEqual(expect.arrayContaining(['screen', 'timezone', 'languages', 'platform', 'hardware']));
  });

  it('sends the hashed install id as the appInstall component, never the raw id', () => {
    expect(buildPayload(READINGS).components.appInstall).toBe('ab'.repeat(14));
    expect(buildPayload({ ...READINGS, installIdHash: null }).components.appInstall).toBeUndefined();
  });

  it('keeps working with readings the device would not give', () => {
    const p = buildPayload({ ...READINGS, screen: null, timezone: null, languages: [], totalMemoryBytes: null, platform: 'android' });
    expect(p.attributes.platform).toBe('Android');
    expect(p.components.screen).toBeUndefined();
    expect(checkPayloadIntegrity(p).mismatched).toEqual([]);
  });

  it('hex-encodes bytes', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
