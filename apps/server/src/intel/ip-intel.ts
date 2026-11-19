import { readFileSync } from 'node:fs';
import { type IpInfo } from '@trace-id/signals/types';
import { CidrSet } from './cidr.js';
import { type GeoLookup, MmdbGeoLookup, NO_GEO, parseAsnList } from './geo.js';

/**
 * IP intelligence for identify. The server combines the operator's lists and databases with any providers named in
 * IP_PROVIDERS (see build.ts and @trace-id/ip-intel); tests pass a ListIpIntelProvider directly. `header` reads a
 * request header (lower-case name), for sources such as a CDN country header.
 */
export interface IpIntelProvider {
  lookup(ip: string, header?: (name: string) => string | null): IpInfo | Promise<IpInfo>;
}

export const IP_INTEL = Symbol('IP_INTEL');

export interface IpIntelFiles {
  torExitListFile?: string | undefined;
  datacenterCidrFile?: string | undefined;
  datacenterAsnFile?: string | undefined;
  blocklistFile?: string | undefined;
  geoipCountryDb?: string | undefined;
  geoipAsnDb?: string | undefined;
  relayCidrFile?: string | undefined;
  vpnCidrFile?: string | undefined;
  vpnAsnFile?: string | undefined;
  proxyCidrFile?: string | undefined;
}

/** Lists added after the first release; optional so existing callers keep working. */
export interface ExtraLists {
  /** Privacy relays such as iCloud Private Relay: reported, not counted as a VPN. */
  relay?: CidrSet;
  /** Commercial VPN exit ranges and VPN provider ASNs. */
  vpn?: CidrSet;
  vpnAsns?: ReadonlySet<number>;
  /** Residential and datacenter proxy exits. */
  proxy?: CidrSet;
}

export class ListIpIntelProvider implements IpIntelProvider {
  constructor(
    private readonly tor: CidrSet,
    private readonly datacenter: CidrSet,
    private readonly blocklist: CidrSet,
    private readonly geo: GeoLookup = NO_GEO,
    private readonly datacenterAsns: ReadonlySet<number> = new Set(),
    private readonly extra: ExtraLists = {},
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
      {
        relay: load(files.relayCidrFile),
        vpn: load(files.vpnCidrFile),
        vpnAsns: files.vpnAsnFile ? parseAsnList(readFileSync(files.vpnAsnFile, 'utf8')) : new Set(),
        ...(files.proxyCidrFile ? { proxy: load(files.proxyCidrFile) } : {}),
      },
    );
  }

  get sizes(): {
    tor: number;
    datacenter: number;
    datacenterAsns: number;
    blocklist: number;
    geo: boolean;
    relay: number;
    vpn: number;
    vpnAsns: number;
    proxy: number;
  } {
    return {
      relay: this.extra.relay?.size ?? 0,
      vpn: this.extra.vpn?.size ?? 0,
      vpnAsns: this.extra.vpnAsns?.size ?? 0,
      proxy: this.extra.proxy?.size ?? 0,
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
      relay: this.extra.relay?.has(ip) ?? false,
      vpn: (this.extra.vpn?.has(ip) ?? false) || (geo.asn !== null && (this.extra.vpnAsns?.has(geo.asn) ?? false)),
      // Undefined without a list, so the signal can say it was not checked.
      ...(this.extra.proxy ? { proxy: this.extra.proxy.has(ip) } : {}),
      location: geo.location ?? null,
    };
  }
}
