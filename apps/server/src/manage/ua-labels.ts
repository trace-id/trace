import { browserFamily, osFamily } from '@trace-id/signals/ua';

const BROWSERS: Record<string, string> = { chrome: 'Chrome', edge: 'Edge', opera: 'Opera', samsung: 'Samsung Internet', firefox: 'Firefox', safari: 'Safari', other: 'Other' };
const SYSTEMS: Record<string, string> = { windows: 'Windows', macos: 'macOS', ios: 'iOS', android: 'Android', linux: 'Linux', chromeos: 'ChromeOS', other: 'Other' };

export type DeviceType = 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Unknown';

export interface UaLabels {
  browser: string;
  os: string;
  deviceType: DeviceType;
}

/** Display names for a user agent, as shown in the dashboard. Headless browsers are called out because they are almost always automation. */
export function uaLabels(ua: string | null | undefined): UaLabels {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };
  const os = osFamily(ua);
  const headless = /Headless/i.test(ua) || /PhantomJS|Puppeteer|Playwright/i.test(ua);
  const browser = headless ? 'Headless Chrome' : (BROWSERS[browserFamily(ua)] ?? 'Other');
  let deviceType: DeviceType;
  if (headless || /bot|crawler|spider/i.test(ua)) deviceType = 'Bot';
  else if (/iPad|Tablet/i.test(ua)) deviceType = 'Tablet';
  else if (/Mobi|iPhone|Android.+Mobile/i.test(ua) || os === 'ios') deviceType = 'Mobile';
  else if (os === 'android') deviceType = 'Tablet';
  else deviceType = 'Desktop';
  return { browser, os: SYSTEMS[os] ?? 'Other', deviceType };
}
