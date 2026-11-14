import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { CidrSet } from '../intel/cidr.js';

/** Non-public ranges a webhook must never reach (IANA special-purpose registries). */
const BLOCKED = CidrSet.from([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/32',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
]);

export function isBlockedAddress(ip: string): boolean {
  return isIP(ip) === 0 || BLOCKED.has(ip);
}

export class BlockedAddressError extends Error {
  readonly code = 'blocked_address';
  constructor(hostname: string) {
    super(`${hostname} resolves to a non-public address`);
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * DNS lookup for outgoing webhook connections. Every resolved address is checked and the
 * connection uses exactly the addresses checked here, so DNS rebinding between "validate"
 * and "connect" is impossible. Any blocked address fails the whole lookup.
 */
export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    const f = options.family;
    const family = f === 'IPv4' ? 4 : f === 'IPv6' ? 6 : typeof f === 'number' ? f : 0;
    const all = options.all === true;
    dnsLookup(hostname, { all: true, family }, (err, addresses) => {
      if (err) return callback(err, []);
      if (addresses.length === 0) return callback(new Error(`no addresses for ${hostname}`), []);
      if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
        return callback(new BlockedAddressError(hostname), []);
      }
      if (all) return callback(null, addresses);
      const first = addresses[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

/** Static checks at registration time; the address check happens again on every delivery. */
export function validateWebhookUrl(raw: string, allowInsecure: boolean): UrlCheck {
  if (raw.length > 2048) return { ok: false, message: 'url is too long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'url is not valid' };
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    return { ok: false, message: 'url must use https' };
  }
  if (url.username || url.password) return { ok: false, message: 'url must not contain credentials' };
  if (url.hash) return { ok: false, message: 'url must not contain a fragment' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowInsecure && (isIP(host) !== 0 ? isBlockedAddress(host) : /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))) {
    return { ok: false, message: 'url must point to a public host' };
  }
  return { ok: true, url };
}
