import { statSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { type IpInfo } from '@trace-id/signals/types';
import { createIpIntel, type IpCacheStore, type IpFacts, type IpIntel, type IpIntelSource, type IpIntelStats, instrument, providersFromEnv } from '@trace-id/ip-intel';
import { type Env } from '../config/env.js';
import { type IpIntelFiles, type IpIntelProvider, ListIpIntelProvider } from './ip-intel.js';
import { UsageHub } from './usage-hub.js';

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


/** What the lookup chain needs besides its sources. Changed at runtime from the dashboard. */
export interface IntelRuntimeOptions {
  timeoutMs: number;
  cacheTtlMs: number;
  sharedCache?: IpCacheStore | undefined;
}

const EMPTY_STATS: IpIntelStats = { lookups: 0, memoryHits: 0, sharedHits: 0, providerCalls: 0, failures: 0, skippedPrivate: 0 };

/**
 * The server's IP intelligence. Providers named in IP_PROVIDERS come first (in that order), then the ones set up in
 * the dashboard (by priority), then the local files. The chain is rebuilt when the dashboard changes a provider,
 * a key or a setting, so nothing needs a restart. Provider failures are logged at most once a minute per provider
 * and never fail an identification.
 */
export class ReloadableIpIntel implements IpIntelProvider {
  private inner: IpIntel;
  /** Kept across rebuilds, so adding a key does not make every known address a cache miss. */
  private readonly memory = new Map<string, { at: number; facts: IpFacts }>();
  private retired: IpIntelStats = { ...EMPTY_STATS };
  private readonly lastWarn = new Map<string, number>();
  private readonly logger = new Logger('IpIntel');

  constructor(
    readonly files: FileIntelSource,
    readonly envSources: IpIntelSource[],
    private options: IntelRuntimeOptions,
    /** Where usage events of every source are reported; the environment sources already emit into it. */
    readonly hub: UsageHub = new UsageHub(),
    private dynamic: IpIntelSource[] = [],
  ) {
    this.inner = this.build();
  }

  private build(): IpIntel {
    return createIpIntel({
      sources: [...this.envSources, ...this.dynamic, this.files],
      timeoutMs: this.options.timeoutMs,
      cacheTtlMs: this.options.cacheTtlMs,
      memory: this.memory,
      ...(this.options.sharedCache ? { sharedCache: this.options.sharedCache } : {}),
      onError: (source, err) => {
        const now = Date.now();
        if (now - (this.lastWarn.get(source) ?? 0) < 60_000) return;
        this.lastWarn.set(source, now);
        this.logger.warn(`${source} unavailable: ${err instanceof Error ? err.message : String(err)}`);
      },
    });
  }

  /** Swaps in new dashboard providers and options. Cached answers survive, in memory and in the shared store. */
  configure(dynamic: IpIntelSource[], options?: Partial<IntelRuntimeOptions>): void {
    const old = this.inner.stats();
    for (const k of Object.keys(old) as (keyof IpIntelStats)[]) this.retired[k] += old[k];
    this.dynamic = dynamic;
    if (options) this.options = { ...this.options, ...options };
    this.inner = this.build();
  }

  lookup(ip: string, header?: (name: string) => string | null): Promise<IpInfo> {
    return this.inner.lookup(ip, header);
  }

  /** Counters since the process started, across reloads. */
  stats(): IpIntelStats {
    const now = this.inner.stats();
    const sum = { ...this.retired };
    for (const k of Object.keys(now) as (keyof IpIntelStats)[]) sum[k] += now[k];
    return sum;
  }

  get runtime(): Readonly<IntelRuntimeOptions> {
    return this.options;
  }
}

/**
 * IP intelligence for the server at startup: providers from IP_PROVIDERS, then the local files. The dashboard's
 * providers are added later by IpProvidersService through `configure`.
 */
export function buildIpIntel(env: Env, raw: Record<string, string | undefined> = process.env): { intel: ReloadableIpIntel; summary: string } {
  const logger = new Logger('IpIntel');
  const files = new FileIntelSource(filesFromEnv(env), (m) => logger.log(m));
  const hub = new UsageHub();
  const providers = providersFromEnv(raw).map((s) => instrument(s, { ref: `env:${s.name}`, onUsage: hub.emit }));
  const intel = new ReloadableIpIntel(files, providers, { timeoutMs: env.IP_PROVIDER_TIMEOUT_MS, cacheTtlMs: env.IP_PROVIDER_CACHE_HOURS * 3_600_000 }, hub);
  const s = files.sizes;
  return {
    intel,
    summary: `providers=${providers.map((p) => p.name).join(',') || 'none'} tor=${s.tor} datacenter=${s.datacenter} datacenterAsns=${s.datacenterAsns} blocklist=${s.blocklist} geo=${s.geo} relay=${s.relay} vpn=${s.vpn} vpnAsns=${s.vpnAsns} proxy=${s.proxy}`,
  };
}
