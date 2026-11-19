import { browserFamily } from './ua.js';

/** JA4 "a" section: protocol, TLS version, SNI, cipher count, extension count, first ALPN; then two hashes. */
const JA4 = /^([tqd])(1[0-3]|s[23]|d[1-3]|00)([di])(\d\d)(\d\d)([0-9a-z]{2})_[0-9a-f]{12}_[0-9a-f]{12}$/;

export interface Ja4Parts {
  protocol: 't' | 'q' | 'd';
  version: string;
  sni: boolean;
  ciphers: number;
  extensions: number;
  alpn: string;
}

export function parseJa4(value: string): Ja4Parts | null {
  const m = JA4.exec(value.trim().toLowerCase());
  if (!m) return null;
  return {
    protocol: m[1] as Ja4Parts['protocol'],
    version: m[2]!,
    sni: m[3] === 'd',
    ciphers: Number(m[4]),
    extensions: Number(m[5]),
    alpn: m[6]!,
  };
}

export function isJa4(value: string): boolean {
  return parseJa4(value) !== null;
}

/**
 * Why a TLS handshake does not fit the browser the user agent claims. Only properties every current browser shares are
 * used (TLS 1.3, SNI for host names, an HTTP/2 or HTTP/3 ALPN offer), so no per-browser fingerprint table is needed:
 * a script library (Python requests, Go net/http defaults, curl without h2) that copies a browser user agent fails these.
 */
export function tlsMismatchReasons(ja4: string, userAgent: string | null, blocklisted: boolean): string[] {
  const reasons: string[] = [];
  if (blocklisted) reasons.push('blocklisted');
  const parts = parseJa4(ja4);
  if (!parts || !userAgent || browserFamily(userAgent) === 'other') return reasons;
  if (parts.version !== '13') reasons.push('oldTlsVersion');
  if (!parts.sni) reasons.push('noSni');
  if (parts.alpn === '00') reasons.push('noAlpn');
  else if (parts.alpn === 'h1') reasons.push('http1Only');
  return reasons;
}
