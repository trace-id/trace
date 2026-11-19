import { browserFamily, osFamily } from '@trace-id/signals/ua';

const BROWSERS: Record<string, string> = { chrome: 'Chrome', edge: 'Edge', opera: 'Opera', samsung: 'Samsung Internet', firefox: 'Firefox', safari: 'Safari', other: 'Unknown' };
const SYSTEMS: Record<string, string> = { windows: 'Windows', macos: 'macOS', ios: 'iOS', android: 'Android', linux: 'Linux', chromeos: 'ChromeOS', other: 'Unknown' };

export function browserLabel(ua: string): string {
  return ua ? (BROWSERS[browserFamily(ua)] ?? 'Unknown') : 'Unknown';
}

export function osLabel(ua: string): string {
  return ua ? (SYSTEMS[osFamily(ua)] ?? 'Unknown') : 'Unknown';
}
