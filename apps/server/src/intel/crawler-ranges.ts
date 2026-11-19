import { readFileSync, statSync } from 'node:fs';
import { createCrawlerVerifier } from '@trace-id/sdk-node/crawlers';

const RECHECK_MS = 10 * 60_000;

/** Crawler name to CIDR prefixes, as `npm run crawler-ranges` writes it. Invalid content reads as no ranges. */
export function readRangesFile(path: string): Record<string, string[]> {
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new Error('crawler ranges file must be a JSON object');
  const out: Record<string, string[]> = {};
  for (const [name, cidrs] of Object.entries(doc)) {
    if (Array.isArray(cidrs)) out[name] = cidrs.filter((c): c is string => typeof c === 'string');
  }
  return out;
}

/**
 * The crawler verifier, rebuilt when the ranges file changes (checked at most every 10 minutes), so a scheduled
 * `npm run crawler-ranges` takes effect without a restart. Without a file, only reverse DNS is used.
 */
export function crawlerVerifierFor(path: string | undefined, log: (msg: string) => void = () => {}) {
  let verify = createCrawlerVerifier();
  let mtime = 0;
  let checkedAt = 0;
  const refresh = () => {
    if (!path) return;
    const now = Date.now();
    if (now - checkedAt < RECHECK_MS && checkedAt !== 0) return;
    checkedAt = now;
    try {
      const m = statSync(path).mtimeMs;
      if (m === mtime) return;
      const ranges = readRangesFile(path);
      verify = createCrawlerVerifier({ ranges });
      mtime = m;
      log(`crawler ranges loaded: ${Object.keys(ranges).length} lists`);
    } catch (err) {
      log(`crawler ranges not loaded: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return (ip: string, crawler: string): Promise<boolean | null> => {
    refresh();
    return verify(ip, crawler);
  };
}
