import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crawlerVerifierFor, readRangesFile } from './crawler-ranges.js';

describe('crawler ranges file', () => {
  it('reads name-to-prefix lists and drops non-string entries', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ranges-')), 'r.json');
    writeFileSync(file, JSON.stringify({ GPTBot: ['132.196.86.0/24', 7], Junk: 'x' }));
    expect(readRangesFile(file)).toEqual({ GPTBot: ['132.196.86.0/24'] });
    writeFileSync(file, '[]');
    expect(() => readRangesFile(file)).toThrow(/JSON object/);
  });

  it('verifies claimed crawlers from the file, and runs without one', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ranges-')), 'r.json');
    writeFileSync(file, JSON.stringify({ GPTBot: ['132.196.86.0/24'] }));
    const logs: string[] = [];
    const verify = crawlerVerifierFor(file, (m) => logs.push(m));
    expect(await verify('132.196.86.7', 'GPTBot')).toBe(true);
    expect(await verify('203.0.113.9', 'GPTBot')).toBe(false);
    expect(logs).toEqual(['crawler ranges loaded: 1 lists']);
    expect(await crawlerVerifierFor(undefined)('132.196.86.7', 'GPTBot')).toBeNull();
    const broken = crawlerVerifierFor(join(file, 'missing.json'), (m) => logs.push(m));
    expect(await broken('132.196.86.7', 'GPTBot')).toBeNull();
    expect(logs.at(-1)).toMatch(/^crawler ranges not loaded/);
  });
});
