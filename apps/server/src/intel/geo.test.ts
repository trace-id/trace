import { describe, expect, it } from 'vitest';
import { CidrSet } from './cidr.js';
import { type GeoLookup, MmdbGeoLookup, NO_GEO, parseAsnList } from './geo.js';
import { ListIpIntelProvider } from './ip-intel.js';

const fakeGeo: GeoLookup = {
  lookup: (ip) =>
    ip === '198.51.100.7'
      ? { country: 'DE', asn: 64500, asnOrg: 'Example Hosting' }
      : { country: 'EG', asn: 64511, asnOrg: 'Example ISP' },
};

describe('parseAsnList', () => {
  it('accepts AS-prefixed and bare numbers, ignores comments and junk', () => {
    expect([...parseAsnList('AS64500\n64501 # cloud\n# header\nas64502\nnot-an-asn\n')]).toEqual([64500, 64501, 64502]);
  });
});

describe('geo in ListIpIntelProvider', () => {
  const none = CidrSet.from([]);

  it('adds country and ASN and flags datacenter ASNs', () => {
    const intel = new ListIpIntelProvider(none, none, none, fakeGeo, new Set([64500]));
    expect(intel.lookup('198.51.100.7')).toMatchObject({ datacenter: true, country: 'DE', asn: 64500, asnOrg: 'Example Hosting' });
    expect(intel.lookup('203.0.113.9')).toMatchObject({ datacenter: false, country: 'EG', asn: 64511 });
  });

  it('works with no geo databases configured', () => {
    expect(MmdbGeoLookup.fromFiles(undefined, undefined)).toBe(NO_GEO);
    const intel = new ListIpIntelProvider(none, none, none);
    expect(intel.lookup('203.0.113.9')).toMatchObject({ country: null, asn: null });
    expect(intel.sizes.geo).toBe(false);
  });
});
