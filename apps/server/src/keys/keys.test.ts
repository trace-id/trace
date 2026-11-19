import { describe, expect, it } from 'vitest';
import { generateKey, hashesEqual, hashKey, parseKey } from './key-crypto.js';
import { appAllowed, isValidOriginPattern, originAllowed } from './origins.js';

describe('key crypto', () => {
  it('generates distinct, well-formed keys with a stable prefix and hash', () => {
    const a = generateKey('public');
    const b = generateKey('secret');
    expect(a.key).toMatch(/^pk_[0-9A-Za-z]{40}$/);
    expect(b.key).toMatch(/^sk_[0-9A-Za-z]{40}$/);
    expect(a.prefix).toBe(a.key.slice(0, 11));
    expect(a.hash).toBe(hashKey(a.key));
    expect(generateKey('public').key).not.toBe(a.key);
  });

  it('parses only well-formed keys', () => {
    const { key, prefix } = generateKey('secret');
    expect(parseKey(key)).toEqual({ type: 'secret', prefix });
    expect(parseKey('sk_short')).toBeNull();
    expect(parseKey(`xx_${key.slice(3)}`)).toBeNull();
  });

  it('compares hashes in constant time and rejects mismatched lengths', () => {
    const h = hashKey('a');
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, hashKey('b'))).toBe(false);
    expect(hashesEqual(h, '')).toBe(false);
  });
});

describe('origins', () => {
  const allowed = ['https://app.example.com', 'http://localhost:5173', 'https://*.example.org'];

  it('allows exact origins and subdomain wildcards', () => {
    expect(originAllowed('https://app.example.com', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(originAllowed('https://a.b.example.org', allowed)).toBe(true);
  });

  it('rejects near misses', () => {
    for (const origin of [
      undefined,
      'null',
      'https://app.example.com.evil.test',
      'http://app.example.com',
      'https://example.org',
      'https://evilexample.org',
      'http://x.example.org',
      'http://localhost:5174',
      'https://app.example.com/',
    ]) {
      expect(originAllowed(origin, allowed)).toBe(false);
    }
  });

  it('validates configured patterns', () => {
    expect(isValidOriginPattern('https://app.example.com')).toBe(true);
    expect(isValidOriginPattern('https://*.example.com')).toBe(true);
    expect(isValidOriginPattern('https://app.example.com/')).toBe(false);
    expect(isValidOriginPattern('*')).toBe(false);
    expect(isValidOriginPattern('https://*')).toBe(false);
  });
});

describe('native app entries', () => {
  it('accepts app:<id> patterns and matches the listed app only', () => {
    expect(isValidOriginPattern('app:com.example.shop')).toBe(true);
    expect(isValidOriginPattern('app:')).toBe(false);
    expect(isValidOriginPattern('app:bad id')).toBe(false);
    const allowed = ['https://shop.example.com', 'app:com.example.shop'];
    expect(appAllowed('com.example.shop', allowed)).toBe(true);
    expect(appAllowed('com.other.app', allowed)).toBe(false);
    expect(appAllowed(undefined, allowed)).toBe(false);
    expect(appAllowed('com.example.shop', ['https://shop.example.com'])).toBe(false);
    // An app entry never matches a web origin.
    expect(originAllowed('app:com.example.shop', allowed)).toBe(false);
  });
});
