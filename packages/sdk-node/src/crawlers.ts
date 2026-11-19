import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { CRAWLER_DNS, CRAWLER_RANGE_SOURCES, parseRangeList } from '@trace-id/signals/agents';

export interface CrawlerResolver {
  reverse(ip: string): Promise<string[]>;
  lookup(host: string): Promise<string[]>;
}

export interface CrawlerVerifierOptions {
  /**
   * Published IP ranges per crawler name (from fetchCrawlerRanges, or your own copy). A crawler with a list is checked
   * against it, without DNS; one without falls back to reverse DNS where its operator documents that.
   */
  ranges?: Readonly<Record<string, readonly string[]>>;
  /** DNS resolver; defaults to the system's. */
  resolver?: CrawlerResolver;
  /** How long a result for an IP is reused. Default 6 hours. */
  cacheMs?: number;
  /** Budget for the two lookups. Default 1000 ms; on timeout the crawler is reported unchecked (null). */
  timeoutMs?: number;
  now?: () => number;
}

const systemResolver: CrawlerResolver = {
  reverse: (ip) => dns.reverse(ip),
  lookup: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
};

/**
 * Confirms a claimed search-engine crawler the way the engines document it: reverse DNS of the IP must end in the
 * operator's domain, and that host name must resolve back to the same IP. A request calling itself Googlebot from any
 * other network fails.
 *
 *   const verifyCrawler = createCrawlerVerifier();
 *   await verifyCrawler('66.249.66.1', 'Googlebot'); // true, false, or null when it could not be checked
 */
export function createCrawlerVerifier(options: CrawlerVerifierOptions = {}): (ip: string, crawler: string) => Promise<boolean | null> {
  const resolver = options.resolver ?? systemResolver;
  const cacheMs = options.cacheMs ?? 6 * 3_600_000;
  const timeoutMs = options.timeoutMs ?? 1000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; ok: boolean }>();

  const check = async (ip: string, suffixes: readonly string[]): Promise<boolean> => {
    const names = await resolver.reverse(ip).catch(() => [] as string[]);
    for (const raw of names) {
      const host = raw.toLowerCase().replace(/\.$/, '');
      if (!suffixes.some((s) => host.endsWith(s))) continue;
      const back = await resolver.lookup(host).catch(() => [] as string[]);
      if (back.includes(ip)) return true;
    }
    return false;
  };

  const lists = new Map<string, BlockList>();
  for (const [name, cidrs] of Object.entries(options.ranges ?? {})) {
    const list = new BlockList();
    let added = 0;
    for (const cidr of cidrs) {
      const [net, bits] = cidr.split('/');
      const family = isIP(net ?? '');
      if (!family || bits === undefined) continue;
      list.addSubnet(net!, Number(bits), family === 6 ? 'ipv6' : 'ipv4');
      added++;
    }
    if (added > 0) lists.set(name, list);
  }

  return async (ip, crawler) => {
    const list = lists.get(crawler);
    if (list) {
      const family = isIP(ip);
      return family ? list.check(ip, family === 6 ? 'ipv6' : 'ipv4') : false;
    }
    const suffixes = CRAWLER_DNS[crawler];
    if (!suffixes) return null;
    const key = `${crawler}|${ip}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.ok;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const ok = await Promise.race([check(ip, suffixes), timeout]);
    clearTimeout(timer);
    if (ok === null) return null;
    cache.set(key, { at: now(), ok });
    return ok;
  };
}

export interface FetchedRanges {
  /** Crawler name to CIDR prefixes, for CrawlerVerifierOptions.ranges. */
  ranges: Record<string, string[]>;
  /** Sources that failed (network, status or shape), so a scheduled job can keep the previous list for them. */
  failed: { name: string; reason: string }[];
}

/**
 * Downloads the IP range lists crawler operators publish (CRAWLER_RANGE_SOURCES). Run it on a schedule, not per
 * request, and store the result: the lists change every few days.
 */
export async function fetchCrawlerRanges(
  options: { fetch?: typeof fetch; timeoutMs?: number; sources?: Readonly<Record<string, string>> } = {},
): Promise<FetchedRanges> {
  const doFetch = options.fetch ?? fetch;
  const out: FetchedRanges = { ranges: {}, failed: [] };
  await Promise.all(
    Object.entries(options.sources ?? CRAWLER_RANGE_SOURCES).map(async ([name, url]) => {
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cidrs = parseRangeList(JSON.parse(await res.text()));
        if (cidrs.length === 0) throw new Error('no prefixes');
        out.ranges[name] = cidrs;
      } catch (err) {
        out.failed.push({ name, reason: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
  return out;
}
