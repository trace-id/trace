import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Downloads free IP data into one folder, for the server's file settings (TOR_EXIT_LIST_FILE, DATACENTER_CIDR_FILE,
 * RELAY_CIDR_FILE, GEOIP_COUNTRY_DB, GEOIP_ASN_DB, VPN_CIDR_FILE). Run it on a schedule; the server reloads files that
 * change. Every file is written atomically, and a source that fails keeps its previous file.
 *
 * Defaults are official, freely usable sources: the Tor Project's relay list, the cloud providers' own published
 * ranges, Apple's iCloud Private Relay egress list and DB-IP's Lite databases (CC BY 4.0: credit "IP data by DB-IP"
 * where you show the data). MaxMind GeoLite2 is fetched with your own account; community VPN lists only on request.
 */

export type DataSource = 'tor' | 'datacenter' | 'relay' | 'dbip' | 'geolite2' | 'x4b-vpn';

export interface DownloadOptions {
  dir: string;
  /** Default: tor, datacenter, relay, dbip; plus geolite2 when MaxMind credentials are given. */
  sources?: DataSource[];
  /** Use DB-IP's City database (60 MB, adds ip.location) instead of Country (4 MB). */
  dbipCity?: boolean;
  maxmind?: { accountId: string; licenseKey: string; edition?: 'GeoLite2-Country' | 'GeoLite2-City' };
  fetch?: typeof fetch;
  now?: Date;
  log?: (msg: string) => void;
}

export interface DownloadResult {
  /** Files written, with the setting each one is for. */
  written: { file: string; setting: string; entries?: number; bytes: number }[];
  failed: { source: DataSource; reason: string }[];
}

const CLOUD_RANGES: { name: string; url: string; parse: (body: string) => string[] }[] = [
  {
    name: 'AWS',
    url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    parse: (b) => {
      const j = JSON.parse(b) as { prefixes?: { ip_prefix?: string }[]; ipv6_prefixes?: { ipv6_prefix?: string }[] };
      return [...(j.prefixes ?? []).map((p) => p.ip_prefix), ...(j.ipv6_prefixes ?? []).map((p) => p.ipv6_prefix)].filter((x): x is string => !!x);
    },
  },
  {
    name: 'Google Cloud',
    url: 'https://www.gstatic.com/ipranges/cloud.json',
    parse: (b) => ((JSON.parse(b) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] }).prefixes ?? []).map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter((x): x is string => !!x),
  },
  {
    name: 'Oracle Cloud',
    url: 'https://docs.oracle.com/iaas/tools/public_ip_ranges.json',
    parse: (b) => ((JSON.parse(b) as { regions?: { cidrs?: { cidr?: string }[] }[] }).regions ?? []).flatMap((r) => (r.cidrs ?? []).map((c) => c.cidr)).filter((x): x is string => !!x),
  },
  { name: 'DigitalOcean', url: 'https://digitalocean.com/geo/google.csv', parse: (b) => csvFirstColumn(b) },
  { name: 'Linode', url: 'https://geoip.linode.com/', parse: (b) => csvFirstColumn(b) },
];

const CIDR = /^[0-9a-fA-F:.]+\/\d{1,3}$|^[0-9a-fA-F:.]+$/;

export function csvFirstColumn(body: string): string[] {
  return body
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',')[0]!.trim())
    .filter((c) => CIDR.test(c));
}

/** Exit addresses (and the relay addresses exits use) from Onionoo, the Tor Project's relay database. */
export function parseOnionoo(body: string): string[] {
  const relays = (JSON.parse(body) as { relays?: { exit_addresses?: string[]; or_addresses?: string[] }[] }).relays ?? [];
  const out = new Set<string>();
  for (const r of relays) {
    for (const a of r.exit_addresses ?? []) out.add(a);
    // "1.2.3.4:443" or "[2001:db8::1]:9001": the host without the port.
    for (const a of r.or_addresses ?? []) out.add(a.startsWith('[') ? a.slice(1, a.indexOf(']')) : a.replace(/:\d+$/, ''));
  }
  return [...out].filter((x) => CIDR.test(x));
}

export async function downloadIpData(o: DownloadOptions): Promise<DownloadResult> {
  const doFetch = o.fetch ?? fetch;
  const log = o.log ?? (() => {});
  const sources = o.sources ?? (['tor', 'datacenter', 'relay', 'dbip', ...(o.maxmind ? (['geolite2'] as const) : [])] as DataSource[]);
  mkdirSync(o.dir, { recursive: true });
  const result: DownloadResult = { written: [], failed: [] };

  const get = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  const write = (name: string, data: Buffer | string, setting: string, entries?: number) => {
    const target = join(o.dir, name);
    writeFileSync(`${target}.tmp`, data);
    renameSync(`${target}.tmp`, target);
    result.written.push({ file: target, setting, ...(entries !== undefined ? { entries } : {}), bytes: Buffer.byteLength(data) });
    log(`${name}: ${entries !== undefined ? `${entries} entries` : `${Math.round(Buffer.byteLength(data) / 1024)} KB`}`);
  };
  const list = (lines: string[]) => `${[...new Set(lines)].join('\n')}\n`;
  const attempt = async (source: DataSource, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      result.failed.push({ source, reason: err instanceof Error ? err.message : String(err) });
      log(`${source}: failed (${err instanceof Error ? err.message : String(err)}); previous file kept`);
    }
  };

  for (const source of sources) {
    if (source === 'tor') {
      await attempt('tor', async () => {
        let ips: string[];
        try {
          ips = parseOnionoo(await (await get('https://onionoo.torproject.org/details?flag=Exit&running=true&fields=exit_addresses,or_addresses')).text());
        } catch {
          ips = (await (await get('https://check.torproject.org/torbulkexitlist')).text()).split(/\r?\n/).filter((l) => CIDR.test(l.trim()));
        }
        if (ips.length < 100) throw new Error(`only ${ips.length} Tor exits; refusing to replace the list`);
        write('tor-exits.txt', list(ips), 'TOR_EXIT_LIST_FILE', ips.length);
      });
    }
    if (source === 'datacenter') {
      await attempt('datacenter', async () => {
        const ranges: string[] = [];
        const missing: string[] = [];
        for (const c of CLOUD_RANGES) {
          try {
            ranges.push(...c.parse(await (await get(c.url)).text()));
          } catch {
            missing.push(c.name);
          }
        }
        if (missing.length === CLOUD_RANGES.length) throw new Error('no cloud provider list could be read');
        if (missing.length) log(`datacenter: skipped ${missing.join(', ')}`);
        write('datacenter.txt', list(ranges), 'DATACENTER_CIDR_FILE', ranges.length);
      });
    }
    if (source === 'relay') {
      await attempt('relay', async () => {
        const ranges = csvFirstColumn(await (await get('https://mask-api.icloud.com/egress-ip-ranges.csv')).text());
        write('icloud-relay.txt', list(ranges), 'RELAY_CIDR_FILE', ranges.length);
      });
    }
    if (source === 'dbip') {
      // Published monthly; early in a month the new file may not be up yet, so fall back to the previous month.
      const now = o.now ?? new Date();
      const months = [0, 1].map((back) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      });
      const fetchDb = async (kind: string): Promise<Buffer> => {
        let last: unknown;
        for (const m of months) {
          try {
            return gunzipSync(Buffer.from(await (await get(`https://download.db-ip.com/free/dbip-${kind}-lite-${m}.mmdb.gz`)).arrayBuffer()));
          } catch (err) {
            last = err;
          }
        }
        throw last;
      };
      await attempt('dbip', async () => write(o.dbipCity ? 'dbip-city.mmdb' : 'dbip-country.mmdb', await fetchDb(o.dbipCity ? 'city' : 'country'), 'GEOIP_COUNTRY_DB'));
      await attempt('dbip', async () => write('dbip-asn.mmdb', await fetchDb('asn'), 'GEOIP_ASN_DB'));
    }
    if (source === 'geolite2') {
      await attempt('geolite2', async () => {
        if (!o.maxmind) throw new Error('needs MaxMind account id and license key');
        const auth = `Basic ${Buffer.from(`${o.maxmind.accountId}:${o.maxmind.licenseKey}`).toString('base64')}`;
        for (const edition of [o.maxmind.edition ?? 'GeoLite2-Country', 'GeoLite2-ASN']) {
          const res = await get(`https://download.maxmind.com/geoip/databases/${edition}/download?suffix=tar.gz`, { headers: { Authorization: auth } });
          write(`${edition}.mmdb`, extractMmdb(Buffer.from(await res.arrayBuffer())), edition === 'GeoLite2-ASN' ? 'GEOIP_ASN_DB' : 'GEOIP_COUNTRY_DB');
        }
      });
    }
    if (source === 'x4b-vpn') {
      await attempt('x4b-vpn', async () => {
        // Community list (github.com/X4BNet/lists_vpn); no license is stated, so check before commercial use.
        const ranges = (await (await get('https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt')).text()).split(/\r?\n/).filter((l) => CIDR.test(l.trim()));
        write('vpn.txt', list(ranges), 'VPN_CIDR_FILE', ranges.length);
      });
    }
  }
  return result;
}

/** The .mmdb inside a MaxMind tar.gz, via the system tar (present on Linux, macOS and Windows 10+). */
function extractMmdb(tgz: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'geolite-'));
  try {
    writeFileSync(join(dir, 'db.tar.gz'), tgz);
    const r = spawnSync('tar', ['-xzf', 'db.tar.gz'], { cwd: dir });
    if (r.status !== 0) throw new Error(`tar failed: ${r.stderr?.toString().trim() || r.status}`);
    const find = (d: string): string | null => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) {
          const f = find(p);
          if (f) return f;
        } else if (e.endsWith('.mmdb')) return p;
      }
      return null;
    };
    const file = find(dir);
    if (!file || !existsSync(file)) throw new Error('no .mmdb in the archive');
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
