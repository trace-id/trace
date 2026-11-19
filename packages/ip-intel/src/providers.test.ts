import { describe, expect, it } from 'vitest';
import { PROVIDERS, providersFromEnv } from './env.js';
import {
  cdnHeaders,
  ipApi,
  ipinfo,
  mapAbuseipdb,
  mapIp2locationIo,
  mapIpApi,
  mapIpapiIs,
  mapIpdata,
  mapIpgeolocation,
  mapIpinfo,
  mapIpqs,
  mapIpregistry,
  mapMaxmind,
  mapProxycheck,
  mapSpur,
} from './providers.js';

// Sample responses follow each provider's documentation (field names and nesting), trimmed to what Trace reads.

describe('provider mappers', () => {
  it('ipinfo Core and Lite', () => {
    expect(
      mapIpinfo({
        ip: '8.8.8.8',
        geo: { city: 'Mountain View', region: 'California', region_code: 'CA', country_code: 'US', latitude: 37.4056, longitude: -122.0775, timezone: 'America/Los_Angeles' },
        as: { asn: 'AS15169', name: 'Google LLC', type: 'hosting' },
        is_anonymous: false,
        is_hosting: true,
      }),
    ).toMatchObject({ country: 'US', asn: 15169, asnOrg: 'Google LLC', vpn: false, datacenter: true, location: { city: 'Mountain View', region: 'CA', timezone: 'America/Los_Angeles' } });
    expect(mapIpinfo({ ip: '8.8.8.8', asn: 'AS15169', as_name: 'Google LLC', country_code: 'US' })).toEqual({ country: 'US', asn: 15169, asnOrg: 'Google LLC' });
  });

  it('IPQualityScore: active flags win over the broad ones, N/A reads as unknown', () => {
    expect(
      mapIpqs({ success: true, proxy: true, vpn: true, active_vpn: false, tor: true, active_tor: false, country_code: 'NL', ASN: 60781, ISP: 'LeaseWeb', city: 'N/A', latitude: 52.37, longitude: 4.89, timezone: 'Europe/Amsterdam', recent_abuse: true }),
    ).toMatchObject({ country: 'NL', asn: 60781, asnOrg: 'LeaseWeb', proxy: true, vpn: false, tor: false, blocklisted: true, location: { city: null } });
    expect(mapIpqs({ success: false, message: 'Invalid key' })).toEqual({});
  });

  it('MaxMind Insights: the anonymizer object, then the deprecated traits', () => {
    const r = mapMaxmind({
      country: { iso_code: 'GB' },
      city: { names: { en: 'London' } },
      subdivisions: [{ iso_code: 'ENG' }],
      location: { latitude: 51.5, longitude: -0.12, accuracy_radius: 20, time_zone: 'Europe/London' },
      traits: { autonomous_system_number: 9009, autonomous_system_organization: 'M247', is_anonymous_vpn: false },
      anonymizer: { is_anonymous_vpn: true, is_hosting_provider: true, is_public_proxy: false, is_residential_proxy: false, is_tor_exit_node: false },
    });
    expect(r).toMatchObject({ country: 'GB', asn: 9009, vpn: true, datacenter: true, proxy: false, tor: false, location: { city: 'London', accuracyRadiusKm: 20 } });
    expect(mapMaxmind({ country: { iso_code: 'US' }, traits: { is_residential_proxy: true } }).proxy).toBe(true);
    expect(mapMaxmind({ country: { iso_code: 'US' } })).toEqual({ country: 'US' });
  });

  it('ipdata', () => {
    expect(
      mapIpdata({
        country_code: 'US',
        city: 'Ashburn',
        region_code: 'VA',
        latitude: 39.04,
        longitude: -77.48,
        asn: { asn: 'AS14618', name: 'Amazon.com, Inc.', type: 'hosting' },
        time_zone: { name: 'America/New_York' },
        threat: { is_tor: false, is_vpn: false, is_icloud_relay: true, is_proxy: false, is_datacenter: true, is_known_attacker: false, is_known_abuser: false, is_threat: false },
      }),
    ).toMatchObject({ country: 'US', asn: 14618, relay: true, datacenter: true, vpn: false, blocklisted: false, location: { region: 'VA', timezone: 'America/New_York' } });
  });

  it('ipapi.is', () => {
    expect(
      mapIpapiIs({ is_vpn: true, is_proxy: false, is_tor: false, is_datacenter: true, is_abuser: false, asn: { asn: 9009, org: 'M247 Europe SRL' }, location: { country_code: 'RO', city: 'Bucharest', state: 'Bucuresti', latitude: 44.43, longitude: 26.1, timezone: 'Europe/Bucharest' } }),
    ).toMatchObject({ country: 'RO', asn: 9009, vpn: true, datacenter: true, location: { city: 'Bucharest' } });
    expect(mapIpapiIs({ location: null })).toEqual({});
  });

  it('IP2Location.io with and without the Security plan', () => {
    const base = { country_code: 'US', region_name: 'California', city_name: 'Mountain View', latitude: 37.4, longitude: -122.07, time_zone: '-07:00', asn: '15169', as: 'Google LLC', is_proxy: false };
    expect(mapIp2locationIo(base)).toMatchObject({ country: 'US', asn: 15169, proxy: false });
    expect(mapIp2locationIo(base)).not.toHaveProperty('vpn');
    expect(mapIp2locationIo({ ...base, is_proxy: true, proxy: { is_vpn: true, is_tor: false, is_data_center: true, is_public_proxy: false, is_web_proxy: false, is_residential_proxy: false } })).toMatchObject({ vpn: true, tor: false, datacenter: true, proxy: false });
  });

  it('ipregistry', () => {
    expect(
      mapIpregistry({
        connection: { asn: 16509, organization: 'Amazon.com, Inc.' },
        location: { country: { code: 'IE' }, region: { code: 'IE-L', name: 'Leinster' }, city: 'Dublin', latitude: 53.34, longitude: -6.26 },
        time_zone: { id: 'Europe/Dublin' },
        security: { is_vpn: false, is_proxy: false, is_tor: false, is_tor_exit: false, is_relay: false, is_cloud_provider: true, is_abuser: false, is_attacker: false, is_threat: false },
      }),
    ).toMatchObject({ country: 'IE', asn: 16509, datacenter: true, vpn: false, tor: false, relay: false, blocklisted: false, location: { timezone: 'Europe/Dublin' } });
  });

  it('proxycheck.io: the result is keyed by IP and typed', () => {
    const r = (type: string, proxy = 'yes') => mapProxycheck({ status: 'ok', '37.60.48.2': { asn: 'AS9009', provider: 'M247 Ltd', isocode: 'GB', city: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', proxy, type } }, '37.60.48.2');
    expect(r('VPN')).toMatchObject({ country: 'GB', asn: 9009, vpn: true, tor: false, proxy: false });
    expect(r('TOR')).toMatchObject({ tor: true, vpn: false });
    expect(r('SOCKS5')).toMatchObject({ proxy: true, vpn: false });
    expect(r('Business', 'no')).toMatchObject({ proxy: false, vpn: false, tor: false });
    expect(mapProxycheck({ status: 'denied', message: 'no key' }, '1.1.1.1')).toEqual({});
  });

  it('Spur: tunnels and infrastructure', () => {
    expect(
      mapSpur({
        as: { number: 49981, organization: 'WorldStream' },
        location: { country: 'NL', city: 'Amsterdam', state: 'North Holland' },
        infrastructure: 'DATACENTER',
        tunnels: [{ type: 'VPN', operator: 'PROTON_VPN', anonymous: true }],
        risks: ['CALLBACK_PROXY', 'TUNNEL'],
      }),
    ).toEqual({ country: 'NL', asn: 49981, asnOrg: 'WorldStream', vpn: true, tor: false, proxy: true, datacenter: true });
  });

  it('AbuseIPDB: blocklisted from the confidence score', () => {
    const d = (score: number, extra = {}) => mapAbuseipdb({ data: { abuseConfidenceScore: score, countryCode: 'CN', usageType: 'Data Center/Web Hosting/Transit', isTor: false, isWhitelisted: false, ...extra } });
    expect(d(100)).toEqual({ country: 'CN', tor: false, datacenter: true, blocklisted: true });
    expect(d(40).blocklisted).toBe(false);
    expect(d(100, { isWhitelisted: true }).blocklisted).toBe(false);
  });

  it('ipgeolocation.io, with security only on paid plans', () => {
    const base = { location: { country_code2: 'DE', city: 'Berlin', state_code: 'DE-BE', latitude: '52.52', longitude: '13.40' }, asn: { as_number: 'AS3320', organization: 'Deutsche Telekom AG' }, time_zone: { name: 'Europe/Berlin' } };
    expect(mapIpgeolocation(base)).toMatchObject({ country: 'DE', asn: 3320, location: { latitude: 52.52 } });
    expect(mapIpgeolocation(base)).not.toHaveProperty('vpn');
    expect(mapIpgeolocation({ ...base, security: { is_vpn: true, is_proxy: false, is_tor: false, is_cloud_provider: false, is_known_attacker: false } })).toMatchObject({ vpn: true, proxy: false });
  });

  it('ip-api', () => {
    expect(mapIpApi({ status: 'success', countryCode: 'EG', region: 'C', city: 'Cairo', lat: 30.04, lon: 31.24, timezone: 'Africa/Cairo', as: 'AS8452 TE Data', asname: 'TE-AS', proxy: false, hosting: false })).toMatchObject({
      country: 'EG',
      asn: 8452,
      asnOrg: 'TE-AS',
      proxy: false,
      datacenter: false,
    });
    expect(mapIpApi({ status: 'fail', message: 'private range' })).toEqual({});
    expect(() => ipApi({})).toThrow(/pro key/);
  });

  it('CDN headers: country, Cloudflare Tor and unknown', async () => {
    const s = cdnHeaders({ countryHeader: 'CF-IPCountry' });
    const run = (v: string | null) => s.lookup('8.8.8.8', { signal: new AbortController().signal, headers: (n) => (n === 'cf-ipcountry' ? v : null) });
    expect(await run('eg')).toEqual({ country: 'EG' });
    expect(await run('T1')).toEqual({ tor: true });
    expect(await run('XX')).toEqual({});
    expect(await run(null)).toEqual({});
  });
});

describe('requests', () => {
  it('sends only the IP and the key, the way each API documents', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = { signal: new AbortController().signal };
    await ipinfo({ token: 't0k', fetch: fake }).lookup('8.8.8.8', ctx);
    await ipinfo({ token: 't0k', plan: 'lite', fetch: fake }).lookup('2606:4700::1111', ctx);
    expect(urls).toEqual(['https://api.ipinfo.io/lookup/8.8.8.8?token=t0k', 'https://api.ipinfo.io/lite/2606%3A4700%3A%3A1111?token=t0k']);
  });

  it('reports provider HTTP errors as errors', async () => {
    const fake = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    await expect(ipinfo({ token: 'x', fetch: fake }).lookup('8.8.8.8', { signal: new AbortController().signal })).rejects.toThrow('ipinfo: HTTP 403');
  });
});

describe('providersFromEnv', () => {
  it('builds providers in order from IP_PROVIDERS and names a missing variable', () => {
    expect(providersFromEnv({ IP_PROVIDERS: 'ipinfo, proxycheck', IPINFO_TOKEN: 'x' }).map((s) => s.name)).toEqual(['ipinfo', 'proxycheck']);
    expect(providersFromEnv({})).toEqual([]);
    expect(() => providersFromEnv({ IP_PROVIDERS: 'spur' })).toThrow('IP_PROVIDERS: spur: missing SPUR_TOKEN');
    expect(() => providersFromEnv({ IP_PROVIDERS: 'nope' })).toThrow(/unknown provider "nope"/);
  });

  it('knows thirteen providers', () => {
    expect(Object.keys(PROVIDERS)).toHaveLength(13);
  });
});
