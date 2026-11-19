import { describe, expect, it } from 'vitest';
import { evaluateSignals } from './definitions.js';
import { TEST_SCORING_CONFIG, makeContext, makePayload } from './testing.js';
import { type AppInfo } from './types.js';

const APP: AppInfo = {
  platform: 'android',
  osVersion: '15',
  manufacturer: 'Google',
  model: 'Pixel 9',
  appId: 'com.example.shop',
  appVersion: '2.4.0',
  buildVersion: '240',
  isDevice: true,
  rooted: false,
  installedAt: 1_760_000_000_000,
};
const run = (app: Partial<AppInfo> | null) => {
  const payload = app ? { ...makePayload(), app: { ...APP, ...app } } : makePayload();
  return evaluateSignals(makeContext({ payload }), TEST_SCORING_CONFIG);
};

describe('app signals', () => {
  it('flags an emulator and reports the model', () => {
    expect(run({ isDevice: false, model: 'sdk_gphone64_x86_64' }).emulator).toEqual({
      detected: true,
      details: { available: true, platform: 'android', model: 'sdk_gphone64_x86_64' },
    });
    expect(run({}).emulator.detected).toBe(false);
    expect(run({ isDevice: null }).emulator).toMatchObject({ detected: false, details: { available: false } });
  });

  it('flags a rooted or jailbroken device', () => {
    expect(run({ rooted: true }).rootedDevice).toEqual({ detected: true, details: { available: true, platform: 'android' } });
    expect(run({ rooted: false }).rootedDevice.detected).toBe(false);
    expect(run({ rooted: null }).rootedDevice.details).toEqual({ available: false, platform: 'android' });
  });

  it('is not available for browsers', () => {
    const r = run(null);
    expect(r.emulator).toEqual({ detected: false, details: { available: false } });
    expect(r.rootedDevice).toEqual({ detected: false, details: { available: false } });
  });
});
