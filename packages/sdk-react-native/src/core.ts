import { hashComponent } from '@trace-id/signals/hash';
import { derivedComponents } from '@trace-id/signals/integrity';
import { type AppInfo, type Components, type DeviceAttributes, type SignalPayload } from '@trace-id/signals/types';

/**
 * Platform-independent part of the SDK: turns native readings into the identify payload. No React Native imports, so
 * it is tested in Node. The readings come from expo.ts in an app.
 */

/** Everything the SDK reads on the device. */
export interface NativeReadings {
  platform: 'ios' | 'android';
  osVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  /** Physical screen in points, as Dimensions.get('screen') reports it. */
  screen: { width: number; height: number; scale: number } | null;
  totalMemoryBytes: number | null;
  timezone: string | null;
  languages: string[];
  appId: string | null;
  appVersion: string | null;
  buildVersion: string | null;
  isDevice: boolean | null;
  rooted: boolean | null;
  installedAt: number | null;
  /** SHA-256 hex of the platform install id (IDFV / ANDROID_ID) salted with the app id; null when unavailable. */
  installIdHash: string | null;
}

/** Neutral values for the browser-only parts of the payload: nothing there applies to a native app. */
function noBrowser(): Pick<SignalPayload, 'bot' | 'tamper' | 'privacy' | 'storage'> {
  return {
    bot: {
      webdriver: false,
      headlessUserAgent: false,
      automationGlobals: [],
      noPlugins: false,
      noLanguages: false,
      permissionsInconsistent: false,
      chromeObjectMissing: false,
      zeroOuterSize: false,
    },
    tamper: { nativeOverrides: [], navigatorOwnProperties: [], uaPlatformMismatch: false, uaFeatureMismatch: false, canvasNoise: false },
    privacy: { incognitoLikely: false, incognitoMethod: null, storageQuotaMb: null },
    storage: { cookie: false, localStorage: false, indexedDb: false },
  };
}

/** Builds the payload. Components the browser SDK derives from attributes are derived the same way, so the server's
 * integrity check (tamperedRequest) passes for an untouched app. */
export function buildPayload(r: NativeReadings, collectMs = 0): SignalPayload {
  const memoryGb = r.totalMemoryBytes ? Math.round((r.totalMemoryBytes / 1024 ** 3) * 4) / 4 : null;
  const attributes: DeviceAttributes = {
    screenWidth: r.screen ? Math.round(r.screen.width) : null,
    screenHeight: r.screen ? Math.round(r.screen.height) : null,
    availWidth: null,
    availHeight: null,
    colorDepth: null,
    pixelRatio: r.screen ? r.screen.scale : null,
    hardwareConcurrency: null,
    deviceMemory: memoryGb,
    maxTouchPoints: 5,
    timezone: r.timezone,
    languages: r.languages.slice(0, 10),
    platform: r.platform === 'ios' ? 'iOS' : 'Android',
    userAgent: null,
    uaBrands: [],
    uaMobile: true,
    uaPlatform: null,
    webglVendor: null,
    // A native app cannot read the GPU without native code; the device model is reported in app.model instead.
    webglRenderer: null,
  };
  const components: Components = {
    ...derivedComponents(attributes, true),
    userAgentFamily: hashComponent(`app|${r.platform}|${r.osVersion?.split('.')[0] ?? ''}`),
    ...(r.installIdHash ? { appInstall: r.installIdHash.slice(0, 28) } : {}),
  };
  const app: AppInfo = {
    platform: r.platform,
    osVersion: r.osVersion,
    manufacturer: r.manufacturer,
    model: r.model,
    appId: r.appId,
    appVersion: r.appVersion,
    buildVersion: r.buildVersion,
    isDevice: r.isDevice,
    rooted: r.rooted,
    installedAt: r.installedAt,
  };
  return { v: 1, components, attributes, ...noBrowser(), app, collectMs };
}

/** Bytes to lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
