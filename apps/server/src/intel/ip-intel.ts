import { readFileSync } from 'node:fs';
import { type IpInfo } from '@tbdname/signals/types';
import { CidrSet } from './cidr.js';
import { type GeoLookup, MmdbGeoLookup, NO_GEO, parseAsnList } from './geo.js';

/**
 * Pluggable IP intelligence. The open build ships list- and file-based lookups only; an
 * operator can plug in a reputation provider by implementing this interface. Lookups are
 * synchronous and in-memory so they stay off the ingest latency budget.
 */
export interface IpIntelProvider {
  lookup(ip: string): IpInfo;
}

export const IP_INTEL = Symbol('IP_INTEL');

export interface IpIntelFiles {
  torExitListFile?: string | undefined;
  datacenterCidrFile?: string | undefined;
  datacenterAsnFile?: string | undefined;
  blocklistFile?: string | undefined;
  geoipCountryDb?: string | undefined;
  geoipAsnDb?: string | undefined;
}

export class ListIpIntelProvider implements IpIntelProvider {
  constructor(
    private readonly tor: CidrSet,
    private readonly datacenter: CidrSet,
    private readonly blocklist: CidrSet,
    private readonly geo: GeoLookup = NO_GEO,
    private readonly datacenterAsns: ReadonlySet<number> = new Set(),
  ) {}

  static fromFiles(files: IpIntelFiles): ListIpIntelProvider {
    const load = (path: string | undefined): CidrSet =>
      path ? CidrSet.fromText(readFileSync(path, 'utf8')) : CidrSet.from([]);
    return new ListIpIntelProvider(
      load(files.torExitListFile),
      load(files.datacenterCidrFile),
      load(files.blocklistFile),
      MmdbGeoLookup.fromFiles(files.geoipCountryDb, files.geoipAsnDb),
      files.datacenterAsnFile ? parseAsnList(readFileSync(files.datacenterAsnFile, 'utf8')) : new Set(),
    );
  }

  get sizes(): { tor: number; datacenter: number; datacenterAsns: number; blocklist: number; geo: boolean } {
    return {
      tor: this.tor.size,
      datacenter: this.datacenter.size,
      datacenterAsns: this.datacenterAsns.size,
      blocklist: this.blocklist.size,
      geo: this.geo !== NO_GEO,
    };
  }

  lookup(ip: string): IpInfo {
    const geo = this.geo.lookup(ip);
    return {
      tor: this.tor.has(ip),
      datacenter: this.datacenter.has(ip) || (geo.asn !== null && this.datacenterAsns.has(geo.asn)),
      blocklisted: this.blocklist.has(ip),
      country: geo.country,
      asn: geo.asn,
      asnOrg: geo.asnOrg,
    };
  }
}
