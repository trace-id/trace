import { describe, expect, it } from 'vitest';
import { CidrSet, parseIp } from './cidr.js';
import { ListIpIntelProvider } from './ip-intel.js';
import { ipKey, networkKey, storableIp } from './ip-storage.js';

describe('parseIp', () => {
  it('parses v4, v6 and folds v4-mapped v6', () => {
    expect(parseIp('192.0.2.1')).toEqual({ version: 4, value: 0xc0000201n });
    expect(parseIp('::1')).toEqual({ version: 6, value: 1n });
    expect(parseIp('::ffff:192.0.2.1')).toEqual({ version: 4, value: 0xc0000201n });
    expect(parseIp('2001:db8::')?.value).toBe(0x20010db8n << 96n);
    expect(parseIp('not-an-ip')).toBeNull();
  });
});

describe('CidrSet', () => {
  const set = CidrSet.fromText(
    ['# documentation ranges', '198.51.100.0/24', '203.0.113.7', '2001:db8:abcd::/48', 'garbage', '10.0.0.0/33', ''].join(
      '\n',
    ),
  );

  it('matches inside ranges and single IPs', () => {
    expect(set.has('198.51.100.0')).toBe(true);
    expect(set.has('198.51.100.255')).toBe(true);
    expect(set.has('203.0.113.7')).toBe(true);
    expect(set.has('2001:db8:abcd:12::1')).toBe(true);
    expect(set.has('::ffff:198.51.100.9')).toBe(true);
  });

  it('does not match outside, and skips invalid entries', () => {
    expect(set.has('198.51.101.0')).toBe(false);
    expect(set.has('203.0.113.8')).toBe(false);
    expect(set.has('2001:db8:abce::1')).toBe(false);
    expect(set.has('10.0.0.1')).toBe(false);
    expect(set.size).toBe(3);
  });

  it('merges overlapping ranges', () => {
    expect(CidrSet.from(['192.0.2.0/25', '192.0.2.128/25', '192.0.2.5']).size).toBe(1);
  });
});

describe('ListIpIntelProvider', () => {
  it('reports membership per list', () => {
    const intel = new ListIpIntelProvider(
      CidrSet.from(['192.0.2.1']),
      CidrSet.from(['198.51.100.0/24']),
      CidrSet.from(['203.0.113.0/24']),
    );
    expect(intel.lookup('192.0.2.1')).toMatchObject({ tor: true, datacenter: false, blocklisted: false });
    expect(intel.lookup('198.51.100.20')).toMatchObject({ tor: false, datacenter: true, blocklisted: false });
    expect(intel.lookup('203.0.113.9')).toMatchObject({ tor: false, datacenter: false, blocklisted: true });
  });

  it('reports proxy exits only when a proxy list is configured', () => {
    const none = CidrSet.from([]);
    const withList = new ListIpIntelProvider(none, none, none, undefined, new Set(), { proxy: CidrSet.from(['100.64.1.0/24']) });
    expect(withList.lookup('100.64.1.9').proxy).toBe(true);
    expect(withList.lookup('100.64.2.9').proxy).toBe(false);
    expect(new ListIpIntelProvider(none, none, none).lookup('100.64.1.9').proxy).toBeUndefined();
    expect(withList.sizes.proxy).toBe(1);
  });
});

describe('storableIp', () => {
  const secret = 's'.repeat(32);
  it('applies the configured minimisation', () => {
    expect(storableIp('192.0.2.77', 'full', secret)).toBe('192.0.2.77');
    expect(storableIp('192.0.2.77', 'truncated', secret)).toBe('192.0.2.0');
    expect(storableIp('2001:db8:1:2:3:4:5:6', 'truncated', secret)).toBe('2001:db8:1::');
    expect(storableIp('192.0.2.77', 'hashed', secret)).toBe(ipKey('192.0.2.77', secret));
    expect(storableIp('192.0.2.77', 'none', secret)).toBeNull();
  });
});

describe('networkKey', () => {
  const secret = 's'.repeat(32);
  it('groups addresses by IPv4 /24 and IPv6 /64, keyed by the secret', () => {
    expect(networkKey('192.0.2.7', secret)).toBe(networkKey('192.0.2.250', secret));
    expect(networkKey('192.0.2.7', secret)).not.toBe(networkKey('192.0.3.7', secret));
    expect(networkKey('::ffff:192.0.2.9', secret)).toBe(networkKey('192.0.2.7', secret));
    expect(networkKey('2001:db8:1:2::1', secret)).toBe(networkKey('2001:db8:1:2:ffff::9', secret));
    expect(networkKey('2001:db8:1:2::1', secret)).not.toBe(networkKey('2001:db8:1:3::1', secret));
    expect(networkKey('192.0.2.7', secret)).not.toBe(networkKey('192.0.2.7', 't'.repeat(32)));
    expect(networkKey('192.0.2.7', secret)).toMatch(/^[0-9a-f]{32}$/);
    expect(networkKey('nope', secret)).toBeNull();
  });

  it('treats IPv4 and IPv6 loopback as one network', () => {
    expect(networkKey('127.0.0.1', secret)).toBe(networkKey('::1', secret));
  });
});
