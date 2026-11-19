/**
 * Downloads the IP ranges crawler and AI agent operators publish and writes them to a JSON file for
 * CRAWLER_RANGES_FILE. Run it daily (cron). A source that fails keeps its previous list from the existing file.
 *
 *   npm run crawler-ranges -w trace-server -- /data/crawler-ranges.json
 */
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { fetchCrawlerRanges } from '@trace-id/sdk-node/crawlers';
import { readRangesFile } from '../intel/crawler-ranges.js';

const out = process.argv[2] ?? 'crawler-ranges.json';
const previous = existsSync(out) ? readRangesFile(out) : {};
const { ranges, failed } = await fetchCrawlerRanges();
const merged: Record<string, string[]> = { ...previous, ...ranges };
for (const f of failed) {
  console.error(`${f.name}: ${f.reason}${previous[f.name] ? ' (kept the previous list)' : ''}`);
}
writeFileSync(`${out}.tmp`, `${JSON.stringify(merged, null, 2)}\n`);
renameSync(`${out}.tmp`, out);
for (const [name, cidrs] of Object.entries(merged)) console.log(`${name.padEnd(16)} ${cidrs.length} prefixes`);
if (Object.keys(ranges).length === 0) process.exit(1);
