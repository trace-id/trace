import { readFileSync } from 'node:fs';
import { type IpInfo } from '@tbdname/signals/types';
import { CidrSet } from './cidr.js';

/**
 * Pluggable IP intelligence. The open build ships only the list-based provider below; an
 * operator can supply a GeoIP/ASN or reputation provider by implementing this interface.
 * Lookups are synchronous and in-memory so they stay off the ingest latency budget.
 */
export interface IpIntelProvider {
  lookup(ip: string): IpInfo;
}

export const IP_INTEL = Symbol('IP_INTEL');

export interface IpListFiles {
  torExitListFile?: string | undefined;
  datacenterCidrFile?: string | undefined;
  blocklistFile?: string | undefined;
}

export class ListIpIntelProvider implements IpIntelProvider {
  constructor(
    private readonly tor: CidrSet,
    private readonly datacenter: CidrSet,
    private readonly blocklist: CidrSet,
  ) {}

  static fromFiles(files: IpListFiles): ListIpIntelProvider {
    const load = (path: string | undefined): CidrSet =>
      path ? CidrSet.fromText(readFileSync(path, 'utf8')) : CidrSet.from([]);
    return new ListIpIntelProvider(load(files.torExitListFile), load(files.datacenterCidrFile), load(files.blocklistFile));
  }

  get sizes(): { tor: number; datacenter: number; blocklist: number } {
    return { tor: this.tor.size, datacenter: this.datacenter.size, blocklist: this.blocklist.size };
  }

  lookup(ip: string): IpInfo {
    return {
      tor: this.tor.has(ip),
      datacenter: this.datacenter.has(ip),
      blocklisted: this.blocklist.has(ip),
      country: null,
      asn: null,
      asnOrg: null,
    };
  }
}
