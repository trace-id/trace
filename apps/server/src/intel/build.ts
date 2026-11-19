import { statSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createIpIntel, type IpFacts, type IpIntelSource, providersFromEnv } from '@trace-id/ip-intel';
import { type Env } from '../config/env.js';
import { type IpIntelFiles, type IpIntelProvider, ListIpIntelProvider } from './ip-intel.js';

const RECHECK_MS = 10 * 60_000;

/**
 * The operator's lists and databases as a source that reports only what is configured (no Tor list means Tor is
 * "not checked", not "no"), reloaded when a file changes so a scheduled `npm run ip-data` needs no restart.
 */
export class FileIntelSource implements IpIntelSource {
  readonly name = 'files';
  readonly remote = false;
  private lists: ListIpIntelProvider;
  private stamps: string;
  private checkedAt = Date.now();

  constructor(
    private readonly files: IpIntelFiles,
    private readonly log: (msg: string) => void = () => {},
    private readonly recheckMs = RECHECK_MS,
  ) {
    this.lists = ListIpIntelProvider.fromFiles(files);
    this.stamps = this.fingerprint();
  }

  get sizes() {
    return this.lists.sizes;
  }

  private fingerprint(): string {
    return Object.values(this.files)
      .filter((p): p is string => typeof p === 'string')
      .map((p) => {
        try {
          const s = statSync(p);
          return `${p}:${s.mtimeMs}:${s.size}`;
        } catch {
          return `${p}:missing`;
        }
      })
      .join('|');
  }

  /** Reloads when any configured file changed; a file that fails to load keeps the previous data. */
  refresh(force = false): void {
    if (!force && Date.now() - this.checkedAt < this.recheckMs) return;
    this.checkedAt = Date.now();
    const stamps = this.fingerprint();
    if (stamps === this.stamps) return;
    try {
      this.lists = ListIpIntelProvider.fromFiles(this.files);
      this.stamps = stamps;
      const s = this.lists.sizes;
      this.log(`ip data reloaded: tor=${s.tor} datacenter=${s.datacenter} relay=${s.relay} vpn=${s.vpn} proxy=${s.proxy} geo=${s.geo}`);
    } catch (err) {
      this.log(`ip data reload failed, keeping the previous data: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  lookup(ip: string): IpFacts {
    this.refresh();
    const r = this.lists.lookup(ip);
    const s = this.lists.sizes;
    const f = this.files;
    return {
      ...(r.country !== null ? { country: r.country } : {}),
      ...(r.asn !== null ? { asn: r.asn } : {}),
      ...(r.asnOrg !== null ? { asnOrg: r.asnOrg } : {}),
      ...(r.location ? { location: r.location } : {}),
      ...(f.torExitListFile ? { tor: r.tor } : {}),
      ...(f.datacenterCidrFile || (f.datacenterAsnFile && s.geo) ? { datacenter: r.datacenter } : {}),
      ...(f.blocklistFile ? { blocklisted: r.blocklisted } : {}),
      ...(f.relayCidrFile ? { relay: r.relay ?? false } : {}),
      ...(f.vpnCidrFile || (f.vpnAsnFile && s.geo) ? { vpn: r.vpn ?? false } : {}),
      ...(f.proxyCidrFile ? { proxy: r.proxy ?? false } : {}),
    };
  }
}

export function filesFromEnv(env: Env): IpIntelFiles {
  return {
    torExitListFile: env.TOR_EXIT_LIST_FILE,
    datacenterCidrFile: env.DATACENTER_CIDR_FILE,
    blocklistFile: env.IP_BLOCKLIST_FILE,
    datacenterAsnFile: env.DATACENTER_ASN_FILE,
    geoipCountryDb: env.GEOIP_COUNTRY_DB,
    geoipAsnDb: env.GEOIP_ASN_DB,
    relayCidrFile: env.RELAY_CIDR_FILE,
    vpnCidrFile: env.VPN_CIDR_FILE,
    vpnAsnFile: env.VPN_ASN_FILE,
    proxyCidrFile: env.PROXY_CIDR_FILE,
  };
}

/**
 * IP intelligence for the server: providers named in IP_PROVIDERS first (in that order), then the local files.
 * Provider failures are logged at most once a minute per provider and never fail an identification.
 */
export function buildIpIntel(env: Env, raw: Record<string, string | undefined> = process.env): { intel: IpIntelProvider; summary: string } {
  const logger = new Logger('IpIntel');
  const files = new FileIntelSource(filesFromEnv(env), (m) => logger.log(m));
  const providers = providersFromEnv(raw);
  const lastWarn = new Map<string, number>();
  const intel = createIpIntel({
    sources: [...providers, files],
    timeoutMs: env.IP_PROVIDER_TIMEOUT_MS,
    cacheTtlMs: env.IP_PROVIDER_CACHE_HOURS * 3_600_000,
    onError: (source, err) => {
      const now = Date.now();
      if (now - (lastWarn.get(source) ?? 0) < 60_000) return;
      lastWarn.set(source, now);
      logger.warn(`${source} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  const s = files.sizes;
  return {
    intel: { lookup: (ip, header) => intel.lookup(ip, header) },
    summary: `providers=${providers.map((p) => p.name).join(',') || 'none'} tor=${s.tor} datacenter=${s.datacenter} datacenterAsns=${s.datacenterAsns} blocklist=${s.blocklist} geo=${s.geo} relay=${s.relay} vpn=${s.vpn} vpnAsns=${s.vpnAsns} proxy=${s.proxy}`,
  };
}
