import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { csvFirstColumn, downloadIpData, parseOnionoo } from './download.js';

describe('parsers', () => {
  it('reads exit and relay addresses from Onionoo, without ports', () => {
    const body = JSON.stringify({
      relays: [
        { or_addresses: ['204.8.96.141:444', '[2620:7:6003::141]:81'], exit_addresses: ['204.8.96.141'] },
        { or_addresses: ['178.218.144.18:443'], exit_addresses: ['178.218.144.19'] },
      ],
    });
    expect(parseOnionoo(body).sort()).toEqual(['178.218.144.18', '178.218.144.19', '204.8.96.141', '2620:7:6003::141']);
  });

  it('reads geofeed and relay CSVs', () => {
    expect(csvFirstColumn('# comment\n5.101.96.0/21,NL,NL-NH,Amsterdam,\n172.224.226.0/27,GB,GB-EN,London,\n\nbad line\n')).toEqual(['5.101.96.0/21', '172.224.226.0/27']);
  });
});

describe('downloadIpData', () => {
  const tor = { relays: Array.from({ length: 150 }, (_, i) => ({ exit_addresses: [`185.220.101.${i}`], or_addresses: [] })) };
  const routes: Record<string, () => Response> = {
    'https://onionoo.torproject.org/details?flag=Exit&running=true&fields=exit_addresses,or_addresses': () => new Response(JSON.stringify(tor)),
    'https://ip-ranges.amazonaws.com/ip-ranges.json': () => new Response(JSON.stringify({ prefixes: [{ ip_prefix: '3.4.12.4/32' }], ipv6_prefixes: [{ ipv6_prefix: '2600:1f00::/24' }] })),
    'https://www.gstatic.com/ipranges/cloud.json': () => new Response(JSON.stringify({ prefixes: [{ ipv4Prefix: '34.1.208.0/20' }] })),
    'https://mask-api.icloud.com/egress-ip-ranges.csv': () => new Response('172.224.226.0/27,GB,GB-EN,London,\n'),
    'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz': () => new Response(gzipSync(Buffer.from('country-db'))),
    'https://download.db-ip.com/free/dbip-asn-lite-2026-11.mmdb.gz': () => new Response(gzipSync(Buffer.from('asn-db'))),
  };
  const fake = (async (url: string) => (routes[url] ?? (() => new Response('nope', { status: 404 })))()) as unknown as typeof fetch;

  it('writes each file for its setting, falls back to last month, and reports failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ipdata-'));
    const r = await downloadIpData({ dir, fetch: fake, now: new Date('2026-11-02T00:00:00Z') });
    expect(r.written.map((w) => [w.setting, w.file.split(/[\\/]/).pop(), w.entries ?? null])).toEqual([
      ['TOR_EXIT_LIST_FILE', 'tor-exits.txt', 150],
      ['DATACENTER_CIDR_FILE', 'datacenter.txt', 3],
      ['RELAY_CIDR_FILE', 'icloud-relay.txt', 1],
      ['GEOIP_COUNTRY_DB', 'dbip-country.mmdb', null],
      ['GEOIP_ASN_DB', 'dbip-asn.mmdb', null],
    ]);
    expect(readFileSync(join(dir, 'dbip-country.mmdb'), 'utf8')).toBe('country-db');
    expect(readFileSync(join(dir, 'datacenter.txt'), 'utf8')).toContain('2600:1f00::/24');
    expect(r.failed).toEqual([]);
  });

  it('keeps the previous file when a source fails or looks wrong', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ipdata-'));
    writeFileSync(join(dir, 'tor-exits.txt'), 'previous\n');
    const tiny = (async (url: string) =>
      url.includes('onionoo') ? new Response(JSON.stringify({ relays: [{ exit_addresses: ['1.2.3.4'] }] })) : new Response('down', { status: 503 })) as unknown as typeof fetch;
    const r = await downloadIpData({ dir, fetch: tiny, sources: ['tor'] });
    expect(r.failed[0]).toMatchObject({ source: 'tor' });
    expect(readFileSync(join(dir, 'tor-exits.txt'), 'utf8')).toBe('previous\n');
  });
});
