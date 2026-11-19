import { describe, expect, it, vi } from 'vitest';
import { createIpIntel, mergeFacts } from './combine.js';
import { type IpFacts, type IpIntelSource } from './types.js';
import { isPublicIp } from './util.js';

const remote = (name: string, answer: IpFacts | (() => Promise<IpFacts>)): IpIntelSource & { calls: number } => {
  const s = {
    name,
    remote: true,
    calls: 0,
    lookup: async () => {
      s.calls++;
      return typeof answer === 'function' ? answer() : answer;
    },
  };
  return s;
};
const local = (answer: IpFacts): IpIntelSource => ({ name: 'local', remote: false, lookup: () => answer });

describe('mergeFacts', () => {
  it('takes the first country, ASN and location in priority order, and ORs the flags', () => {
    const m = mergeFacts([{ country: 'DE', vpn: false }, { country: 'FR', asn: 3320, vpn: true, proxy: false }, { asn: 1 }]);
    expect(m).toMatchObject({ country: 'DE', asn: 3320, vpn: true, proxy: false, tor: false, datacenter: false });
    expect('relay' in m).toBe(false);
  });

  it('keeps "not checked" apart from "checked and clean" for the newer flags', () => {
    expect(mergeFacts([{ country: 'DE' }])).not.toHaveProperty('vpn');
    expect(mergeFacts([{ vpn: false }]).vpn).toBe(false);
  });
});

describe('createIpIntel', () => {
  it('combines local and remote sources', async () => {
    const intel = createIpIntel({ sources: [remote('p', { vpn: true, country: 'NL' }), local({ country: 'DE', tor: false, asn: 1 })] });
    expect(await intel.lookup('8.8.8.8')).toMatchObject({ vpn: true, country: 'NL', asn: 1 });
    expect(intel.sources).toEqual(['p', 'local']);
  });

  it('caches remote answers per IP and shares concurrent lookups', async () => {
    let t = 0;
    const p = remote('p', { vpn: true });
    const intel = createIpIntel({ sources: [p], now: () => t });
    await Promise.all([intel.lookup('8.8.8.8'), intel.lookup('8.8.8.8')]);
    await intel.lookup('8.8.8.8');
    expect(p.calls).toBe(1);
    t = 25 * 3_600_000;
    await intel.lookup('8.8.8.8');
    expect(p.calls).toBe(2);
  });

  it('never sends private or reserved addresses to a provider', async () => {
    const p = remote('p', { vpn: true });
    const intel = createIpIntel({ sources: [p, local({ country: 'DE' })] });
    for (const ip of ['10.1.2.3', '192.168.1.1', '127.0.0.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '2001:db8::5']) {
      expect((await intel.lookup(ip)).country).toBe('DE');
    }
    expect(p.calls).toBe(0);
  });

  it('answers within the time budget when a provider hangs or fails, and does not cache the gap', async () => {
    const errors: string[] = [];
    const slow = remote('slow', () => new Promise(() => {}));
    const broken = remote('broken', () => Promise.reject(new Error('HTTP 500')));
    const intel = createIpIntel({ sources: [slow, broken, local({ country: 'DE' })], timeoutMs: 50, onError: (s) => errors.push(s) });
    const started = Date.now();
    const r = await intel.lookup('8.8.8.8');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.country).toBe('DE');
    expect(r).not.toHaveProperty('vpn');
    expect(errors.sort()).toEqual(['broken', 'slow']);
    await intel.lookup('8.8.8.8');
    expect(broken.calls).toBe(2);
  });

  it('passes request headers to local sources', async () => {
    const seen = vi.fn((_country: string | null | undefined) => ({}));
    const intel = createIpIntel({ sources: [{ name: 'h', remote: false, lookup: (_ip, ctx) => seen(ctx.headers?.('cf-ipcountry')) }] });
    await intel.lookup('8.8.8.8', (n) => (n === 'cf-ipcountry' ? 'EG' : null));
    expect(seen).toHaveBeenCalledWith('EG');
  });
});

describe('isPublicIp', () => {
  it('accepts public addresses only', () => {
    expect(['8.8.8.8', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8'].every(isPublicIp)).toBe(true);
    expect(['10.0.0.1', '172.16.5.4', '169.254.1.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', 'not-an-ip', '::ffff:10.0.0.1'].some(isPublicIp)).toBe(false);
  });
});
