import { createHmac } from 'node:crypto';
import { parseIp } from './cidr.js';

export type IpStorageMode = 'full' | 'truncated' | 'hashed' | 'none';

function v4ToString(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => ((value >> s) & 0xffn).toString()).join('.');
}

function v6ToString(value: bigint): string {
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16));
  return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
}

/** Keyed hash for internal counters (velocity, rate limits); never stored or returned. */
export function ipKey(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

/** What gets written to the events table, per the operator's data-minimisation choice. */
export function storableIp(ip: string, mode: IpStorageMode, secret: string): string | null {
  if (mode === 'none') return null;
  const parsed = parseIp(ip);
  if (!parsed) return null;
  if (mode === 'hashed') return ipKey(ip, secret);
  if (parsed.version === 4) {
    return v4ToString(mode === 'truncated' ? (parsed.value >> 8n) << 8n : parsed.value);
  }
  return v6ToString(mode === 'truncated' ? (parsed.value >> 80n) << 80n : parsed.value);
}

/** Keyed hash of the network an address belongs to (IPv4 /24, IPv6 /64), for cross-browser linking; never returned. */
export function networkKey(ip: string, secret: string): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  // 127.0.0.0/8 and ::1 are one machine: browsers on it may reach "localhost" over either.
  const loopback = parsed.version === 4 ? parsed.value >> 24n === 127n : parsed.value === 1n;
  const prefix = loopback
    ? 'loopback'
    : parsed.version === 4
      ? `4:${(parsed.value >> 8n).toString(16)}`
      : `6:${(parsed.value >> 64n).toString(16)}`;
  return createHmac('sha256', secret).update(`net:${prefix}`).digest('hex').slice(0, 32);
}
