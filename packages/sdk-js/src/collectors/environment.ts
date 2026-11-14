import { type DeviceAttributes, type UaBrand } from '@tbdname/signals/types';
import { safe } from './safe.js';

const MAX_STR = 256;

function clip(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.slice(0, MAX_STR);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface UaData {
  brands?: UaBrand[];
  mobile?: boolean;
  platform?: string;
}

export function readAttributes(webglVendor: string | null, webglRenderer: string | null): DeviceAttributes {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: UaData };
  const uaData = safe(() => nav.userAgentData ?? null, null);
  return {
    screenWidth: safe(() => num(screen.width), null),
    screenHeight: safe(() => num(screen.height), null),
    availWidth: safe(() => num(screen.availWidth), null),
    availHeight: safe(() => num(screen.availHeight), null),
    colorDepth: safe(() => num(screen.colorDepth), null),
    pixelRatio: safe(() => num(window.devicePixelRatio), null),
    hardwareConcurrency: safe(() => num(nav.hardwareConcurrency), null),
    deviceMemory: safe(() => num(nav.deviceMemory), null),
    maxTouchPoints: safe(() => num(nav.maxTouchPoints), null),
    timezone: safe(() => clip(Intl.DateTimeFormat().resolvedOptions().timeZone), null),
    languages: safe(() => (nav.languages ?? [nav.language]).filter(Boolean).slice(0, 10).map((l) => l.slice(0, 35)), []),
    platform: safe(() => clip(nav.platform), null),
    userAgent: safe(() => clip(nav.userAgent), null),
    uaBrands: safe(
      () =>
        (uaData?.brands ?? [])
          .slice(0, 10)
          .map((b) => ({ brand: String(b.brand).slice(0, 64), version: String(b.version).slice(0, 32) })),
      [],
    ),
    uaMobile: safe(() => (typeof uaData?.mobile === 'boolean' ? uaData.mobile : null), null),
    uaPlatform: safe(() => clip(uaData?.platform), null),
    webglVendor: clip(webglVendor),
    webglRenderer: clip(webglRenderer),
  };
}

/** Orientation-independent, so rotating a phone or tablet keeps the same reading. */
export function screenKey(a: DeviceAttributes): string | null {
  if (a.screenWidth === null || a.screenHeight === null) return null;
  const long = Math.max(a.screenWidth, a.screenHeight);
  const short = Math.min(a.screenWidth, a.screenHeight);
  return `${long}x${short}|${a.colorDepth ?? ''}|${a.pixelRatio ?? ''}`;
}

export function hardwareKey(a: DeviceAttributes): string {
  const touch = safe(() => 'ontouchstart' in window, false);
  return `${a.hardwareConcurrency ?? ''}|${a.deviceMemory ?? ''}|${a.maxTouchPoints ?? ''}|${touch}`;
}
