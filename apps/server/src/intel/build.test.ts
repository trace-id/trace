import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';
import { buildIpIntel, FileIntelSource } from './build.js';

const env = (extra: Record<string, string> = {}) =>
  parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x@localhost/x', TOKEN_SECRET: 'x'.repeat(32), AUTH_SECRET: 'y'.repeat(32), ...extra });

describe('FileIntelSource', () => {
  it('reports only what is configured, so a missing list reads as "not checked"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intel-'));
    writeFileSync(join(dir, 'tor.txt'), '185.220.101.1\n');
    const s = new FileIntelSource({ torExitListFile: join(dir, 'tor.txt') });
    expect(s.lookup('185.220.101.1')).toEqual({ tor: true });
    expect(s.lookup('8.8.8.8')).toEqual({ tor: false });
  });

  it('reloads a changed file, and keeps the previous data when the new one cannot be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intel-'));
    const file = join(dir, 'vpn.txt');
    writeFileSync(file, '203.0.113.0/24\n');
    const logs: string[] = [];
    const s = new FileIntelSource({ vpnCidrFile: file }, (m) => logs.push(m), 0);
    expect(s.lookup('198.51.100.7')).toEqual({ vpn: false });
    writeFileSync(file, '198.51.100.0/24\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(s.lookup('198.51.100.7')).toEqual({ vpn: true });
    expect(logs.at(-1)).toMatch(/^ip data reloaded: .*vpn=1/);
  });
});

describe('buildIpIntel', () => {
  it('puts providers first, then files, and fails fast on a misconfigured provider', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intel-'));
    writeFileSync(join(dir, 'tor.txt'), '185.220.101.1\n');
    const { intel, summary } = buildIpIntel(env({ TOR_EXIT_LIST_FILE: join(dir, 'tor.txt') }), { IP_PROVIDERS: 'cdn-headers', IP_COUNTRY_HEADER: 'cf-ipcountry' });
    expect(summary).toMatch(/^providers=cdn-headers tor=1/);
    const r = await intel.lookup('185.220.101.1', (n) => (n === 'cf-ipcountry' ? 'DE' : null));
    expect(r).toMatchObject({ tor: true, country: 'DE' });
    expect(() => buildIpIntel(env(), { IP_PROVIDERS: 'ipinfo' })).toThrow('IP_PROVIDERS: ipinfo: missing IPINFO_TOKEN');
  });
});
