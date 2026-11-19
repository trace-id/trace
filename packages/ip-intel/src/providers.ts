import { type FetchOptions, type IpFacts, type IpIntelSource } from './types.js';
import { bool, country, facts, getJson, location, num, parseAsn, rec, str } from './util.js';

/**
 * Adapters for IP data providers. Each has a pure `map…` function from the provider's documented JSON to Trace's
 * fields (tested against sample responses) and a source that calls the API. Only the IP is sent. Keys come from the
 * operator; Trace ships none.
 *
 * Mapping rules: a flag is reported only when the provider's plan returns it (absent means "not checked");
 * country, ASN and location are reported when present.
 */

const enc = encodeURIComponent;
type Opts<T> = T & FetchOptions;
const source = (name: string, run: (ip: string, signal: AbortSignal, doFetch: typeof fetch) => Promise<IpFacts>, o: FetchOptions): IpIntelSource => ({
  name,
  remote: true,
  lookup: (ip, ctx) => run(ip, ctx.signal, o.fetch ?? fetch),
});

// ---------- ipinfo (Lite: country and ASN; Core: adds location and anonymity/hosting flags)

export function mapIpinfo(json: unknown): IpFacts {
  const j = rec(json);
  // Core: { geo: {...}, as: {...}, is_anonymous, is_hosting }. Lite: { asn, as_name, country_code }.
  const geo = rec(j.geo);
  const as = rec(j.as);
  return facts({
    country: country(geo.country_code ?? j.country_code),
    asn: parseAsn(as.asn ?? j.asn),
    asnOrg: str(as.name ?? j.as_name),
    // Core's single anonymity flag covers VPN, proxy, Tor and relays; Trace reports it as VPN.
    vpn: bool(j.is_anonymous),
    datacenter: bool(j.is_hosting),
    location: geo.latitude !== undefined ? location({ city: geo.city, region: geo.region_code ?? geo.region, latitude: geo.latitude, longitude: geo.longitude, timezone: geo.timezone }) : undefined,
  });
}

export function ipinfo(o: Opts<{ token: string; plan?: 'lite' | 'core' }>): IpIntelSource {
  const path = o.plan === 'lite' ? 'lite' : 'lookup';
  return source('ipinfo', async (ip, signal, f) => mapIpinfo(await getJson('ipinfo', f, `https://api.ipinfo.io/${path}/${enc(ip)}?token=${enc(o.token)}`, { signal })), o);
}

// ---------- IPQualityScore

export function mapIpqs(json: unknown): IpFacts {
  const j = rec(json);
  if (j.success === false) return {};
  return facts({
    country: country(j.country_code),
    asn: parseAsn(j.ASN),
    asnOrg: str(j.ISP) ?? str(j.Organization),
    // `vpn` and `tor` are documented as always true whenever `proxy` is; the `active_*` fields are the specific ones.
    vpn: j.active_vpn === undefined ? bool(j.vpn) : bool(j.active_vpn),
    tor: j.active_tor === undefined ? bool(j.tor) : bool(j.active_tor),
    proxy: bool(j.proxy),
    blocklisted: j.recent_abuse === undefined ? undefined : bool(j.recent_abuse),
    location: location({ city: j.city, region: j.region, latitude: j.latitude, longitude: j.longitude, timezone: j.timezone }) ?? undefined,
  });
}

export function ipqualityscore(o: Opts<{ key: string; strictness?: 0 | 1 | 2 | 3 }>): IpIntelSource {
  return source('ipqualityscore', async (ip, signal, f) =>
    mapIpqs(await getJson('ipqualityscore', f, `https://www.ipqualityscore.com/api/json/ip/${enc(o.key)}/${enc(ip)}?strictness=${o.strictness ?? 1}`, { signal })),
  o);
}

// ---------- MaxMind GeoIP web services (Country, City Plus, Insights)

export function mapMaxmind(json: unknown): IpFacts {
  const j = rec(json);
  const traits = rec(j.traits);
  const anon = rec(j.anonymizer);
  const loc = rec(j.location);
  const sub = rec(Array.isArray(j.subdivisions) ? j.subdivisions[0] : undefined);
  // Insights has the newer `anonymizer` object; the same flags in `traits` are deprecated but still sent.
  const pick = (k: string) => bool(anon[k] ?? traits[k]);
  return facts({
    country: country(rec(j.country).iso_code ?? rec(j.registered_country).iso_code),
    asn: parseAsn(traits.autonomous_system_number),
    asnOrg: str(traits.autonomous_system_organization),
    vpn: pick('is_anonymous_vpn'),
    proxy: pick('is_public_proxy') === true || pick('is_residential_proxy') === true ? true : (pick('is_public_proxy') ?? pick('is_residential_proxy')),
    tor: pick('is_tor_exit_node'),
    datacenter: pick('is_hosting_provider'),
    location: location({ city: rec(rec(j.city).names).en, region: sub.iso_code, latitude: loc.latitude, longitude: loc.longitude, accuracyRadiusKm: loc.accuracy_radius, timezone: loc.time_zone }) ?? undefined,
  });
}

export function maxmind(o: Opts<{ accountId: string; licenseKey: string; service?: 'country' | 'city' | 'insights' }>): IpIntelSource {
  const auth = `Basic ${Buffer.from(`${o.accountId}:${o.licenseKey}`).toString('base64')}`;
  return source('maxmind', async (ip, signal, f) =>
    mapMaxmind(await getJson('maxmind', f, `https://geoip.maxmind.com/geoip/v2.1/${o.service ?? 'insights'}/${enc(ip)}`, { signal, headers: { Authorization: auth } })),
  o);
}

// ---------- ipdata

export function mapIpdata(json: unknown): IpFacts {
  const j = rec(json);
  const t = rec(j.threat);
  const as = rec(j.asn);
  return facts({
    country: country(j.country_code),
    asn: parseAsn(as.asn),
    asnOrg: str(as.name),
    vpn: bool(t.is_vpn),
    tor: bool(t.is_tor),
    proxy: bool(t.is_proxy),
    relay: bool(t.is_icloud_relay),
    datacenter: bool(t.is_datacenter),
    blocklisted: t.is_known_attacker === true || t.is_known_abuser === true || t.is_threat === true ? true : bool(t.is_threat),
    location: location({ city: j.city, region: j.region_code ?? j.region, latitude: j.latitude, longitude: j.longitude, timezone: rec(j.time_zone).name }) ?? undefined,
  });
}

export function ipdata(o: Opts<{ key: string }>): IpIntelSource {
  return source('ipdata', async (ip, signal, f) => mapIpdata(await getJson('ipdata', f, `https://api.ipdata.co/${enc(ip)}?api-key=${enc(o.key)}`, { signal })), o);
}

// ---------- ipapi.is

export function mapIpapiIs(json: unknown): IpFacts {
  const j = rec(json);
  const as = rec(j.asn);
  const loc = rec(j.location);
  return facts({
    country: country(loc.country_code),
    asn: parseAsn(as.asn),
    asnOrg: str(as.org),
    vpn: bool(j.is_vpn),
    tor: bool(j.is_tor),
    proxy: bool(j.is_proxy),
    datacenter: bool(j.is_datacenter),
    blocklisted: bool(j.is_abuser),
    location: location({ city: loc.city, region: loc.state, latitude: loc.latitude, longitude: loc.longitude, timezone: loc.timezone }) ?? undefined,
  });
}

export function ipapiIs(o: Opts<{ key: string }>): IpIntelSource {
  return source('ipapi.is', async (ip, signal, f) => mapIpapiIs(await getJson('ipapi.is', f, `https://api.ipapi.is/?q=${enc(ip)}&key=${enc(o.key)}`, { signal })), o);
}

// ---------- IP2Location.io (proxy details need the Security plan)

export function mapIp2locationIo(json: unknown): IpFacts {
  const j = rec(json);
  const p = rec(j.proxy);
  const hasProxy = Object.keys(p).length > 0;
  return facts({
    country: country(j.country_code),
    asn: parseAsn(j.asn),
    asnOrg: str(j.as),
    vpn: hasProxy ? bool(p.is_vpn) : undefined,
    tor: hasProxy ? bool(p.is_tor) : undefined,
    datacenter: hasProxy ? bool(p.is_data_center) : undefined,
    proxy: hasProxy ? p.is_public_proxy === true || p.is_web_proxy === true || p.is_residential_proxy === true : bool(j.is_proxy),
    // time_zone here is an offset ("+02:00"), not a zone name, so it is left out.
    location: location({ city: j.city_name, region: j.region_name, latitude: j.latitude, longitude: j.longitude }) ?? undefined,
  });
}

export function ip2locationIo(o: Opts<{ key: string }>): IpIntelSource {
  return source('ip2location.io', async (ip, signal, f) =>
    mapIp2locationIo(await getJson('ip2location.io', f, `https://api.ip2location.io/?ip=${enc(ip)}`, { signal, headers: { Authorization: `Bearer ${o.key}` } })),
  o);
}

// ---------- ipregistry

export function mapIpregistry(json: unknown): IpFacts {
  const j = rec(json);
  const s = rec(j.security);
  const c = rec(j.connection);
  const loc = rec(j.location);
  return facts({
    country: country(rec(loc.country).code),
    asn: parseAsn(c.asn),
    asnOrg: str(c.organization),
    vpn: bool(s.is_vpn),
    tor: s.is_tor_exit === undefined ? bool(s.is_tor) : bool(s.is_tor_exit),
    proxy: bool(s.is_proxy),
    relay: bool(s.is_relay),
    datacenter: bool(s.is_cloud_provider),
    blocklisted: s.is_threat === true || s.is_attacker === true || s.is_abuser === true ? true : bool(s.is_threat),
    location: location({ city: loc.city, region: rec(loc.region).code ?? rec(loc.region).name, latitude: loc.latitude, longitude: loc.longitude, timezone: rec(j.time_zone).id }) ?? undefined,
  });
}

export function ipregistry(o: Opts<{ key: string }>): IpIntelSource {
  return source('ipregistry', async (ip, signal, f) => mapIpregistry(await getJson('ipregistry', f, `https://api.ipregistry.co/${enc(ip)}?key=${enc(o.key)}`, { signal })), o);
}

// ---------- proxycheck.io (v2)

export function mapProxycheck(json: unknown, ip: string): IpFacts {
  const j = rec(json);
  if (j.status === 'error' || j.status === 'denied') return {};
  const r = rec(j[ip]);
  if (Object.keys(r).length === 0) return {};
  const isProxy = bool(r.proxy);
  const type = typeof r.type === 'string' ? r.type.toUpperCase() : '';
  return facts({
    country: country(r.isocode),
    asn: parseAsn(r.asn),
    asnOrg: str(r.provider) ?? str(r.organisation),
    vpn: isProxy === undefined ? undefined : isProxy && type === 'VPN',
    tor: isProxy === undefined ? undefined : isProxy && type === 'TOR',
    proxy: isProxy === undefined ? undefined : isProxy && type !== 'VPN' && type !== 'TOR',
    location: location({ city: r.city, region: r.regioncode ?? r.region, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone }) ?? undefined,
  });
}

export function proxycheck(o: Opts<{ key?: string }>): IpIntelSource {
  return source('proxycheck', async (ip, signal, f) =>
    mapProxycheck(await getJson('proxycheck', f, `https://proxycheck.io/v2/${enc(ip)}?vpn=1&asn=1${o.key ? `&key=${enc(o.key)}` : ''}`, { signal }), ip),
  o);
}

// ---------- Spur (Context API): residential proxies and VPN operators

export function mapSpur(json: unknown): IpFacts {
  const j = rec(json);
  const as = rec(j.as);
  const loc = rec(j.location);
  const tunnels = Array.isArray(j.tunnels) ? j.tunnels.map(rec) : [];
  const types = new Set(tunnels.map((t) => String(t.type ?? '').toUpperCase()));
  const risks = new Set((Array.isArray(j.risks) ? j.risks : []).map((r) => String(r).toUpperCase()));
  return facts({
    country: country(loc.country),
    asn: parseAsn(as.number),
    asnOrg: str(as.organization),
    // Spur describes what it saw; no tunnel means none was seen, which counts as checked.
    vpn: types.has('VPN'),
    tor: types.has('TOR'),
    proxy: types.has('PROXY') || risks.has('CALLBACK_PROXY'),
    datacenter: String(j.infrastructure ?? '').toUpperCase() === 'DATACENTER',
  });
}

export function spur(o: Opts<{ token: string }>): IpIntelSource {
  return source('spur', async (ip, signal, f) => mapSpur(await getJson('spur', f, `https://api.spur.us/v2/context/${enc(ip)}`, { signal, headers: { Token: o.token } })), o);
}

// ---------- AbuseIPDB: abuse reputation, Tor and hosting

export function mapAbuseipdb(json: unknown, minScore = 75): IpFacts {
  const d = rec(rec(json).data);
  const score = num(d.abuseConfidenceScore);
  const usage = typeof d.usageType === 'string' ? d.usageType : '';
  return facts({
    country: country(d.countryCode),
    tor: bool(d.isTor),
    datacenter: usage ? /data center|hosting/i.test(usage) : undefined,
    blocklisted: score === null ? undefined : score >= minScore && d.isWhitelisted !== true,
  });
}

export function abuseipdb(o: Opts<{ key: string; minScore?: number; maxAgeInDays?: number }>): IpIntelSource {
  return source('abuseipdb', async (ip, signal, f) =>
    mapAbuseipdb(await getJson('abuseipdb', f, `https://api.abuseipdb.com/api/v2/check?ipAddress=${enc(ip)}&maxAgeInDays=${o.maxAgeInDays ?? 30}`, { signal, headers: { Key: o.key } }), o.minScore),
  o);
}

// ---------- ipgeolocation.io (v3; security needs a paid plan)

export function mapIpgeolocation(json: unknown): IpFacts {
  const j = rec(json);
  const loc = rec(j.location);
  const as = rec(j.asn);
  const s = rec(j.security);
  const hasSecurity = Object.keys(s).length > 0;
  return facts({
    country: country(loc.country_code2),
    asn: parseAsn(as.as_number ?? as.asn),
    asnOrg: str(as.organization),
    vpn: hasSecurity ? bool(s.is_vpn) : undefined,
    tor: hasSecurity ? bool(s.is_tor) : undefined,
    proxy: hasSecurity ? bool(s.is_proxy) : undefined,
    datacenter: hasSecurity ? bool(s.is_cloud_provider) : undefined,
    blocklisted: hasSecurity ? bool(s.is_known_attacker) : undefined,
    location: location({ city: loc.city, region: loc.state_code ?? loc.state_prov, latitude: loc.latitude, longitude: loc.longitude, timezone: rec(j.time_zone).name }) ?? undefined,
  });
}

export function ipgeolocation(o: Opts<{ key: string; security?: boolean }>): IpIntelSource {
  return source('ipgeolocation', async (ip, signal, f) =>
    mapIpgeolocation(await getJson('ipgeolocation', f, `https://api.ipgeolocation.io/v3/ipgeo?apiKey=${enc(o.key)}&ip=${enc(ip)}${o.security ? '&include=security' : ''}`, { signal })),
  o);
}

// ---------- ip-api.com (paid "pro" endpoint over HTTPS; the free endpoint is HTTP-only and non-commercial)

export function mapIpApi(json: unknown): IpFacts {
  const j = rec(json);
  if (j.status !== 'success') return {};
  return facts({
    country: country(j.countryCode),
    asn: parseAsn(j.as),
    asnOrg: str(j.asname) ?? str(j.org),
    proxy: bool(j.proxy),
    datacenter: bool(j.hosting),
    location: location({ city: j.city, region: j.region, latitude: j.lat, longitude: j.lon, timezone: j.timezone }) ?? undefined,
  });
}

const IP_API_FIELDS = 'status,message,countryCode,region,city,lat,lon,timezone,org,as,asname,proxy,hosting';

export function ipApi(o: Opts<{ key?: string; allowFreeHttp?: boolean }>): IpIntelSource {
  if (!o.key && !o.allowFreeHttp) throw new Error('ip-api: pass a pro key, or allowFreeHttp for the free endpoint (HTTP only, non-commercial use)');
  const base = o.key ? `https://pro.ip-api.com/json/` : 'http://ip-api.com/json/';
  return source('ip-api', async (ip, signal, f) =>
    mapIpApi(await getJson('ip-api', f, `${base}${enc(ip)}?fields=${IP_API_FIELDS}${o.key ? `&key=${enc(o.key)}` : ''}`, { signal })),
  o);
}

// ---------- CDN headers: free country from the edge in front of you

/**
 * The visitor's country from a header your CDN sets (Cloudflare `cf-ipcountry`, Vercel `x-vercel-ip-country`,
 * CloudFront `cloudfront-viewer-country`, Fastly via your VCL). Only enable it when that CDN is the only way in:
 * otherwise anyone can send the header.
 */
export function cdnHeaders(o: { countryHeader: string }): IpIntelSource {
  const header = o.countryHeader.toLowerCase();
  return {
    name: 'cdn-headers',
    remote: false,
    lookup: (_ip, ctx) => {
      const c = country(ctx.headers?.(header));
      // Cloudflare uses XX for unknown and T1 for Tor.
      if (ctx.headers?.(header)?.toUpperCase() === 'T1') return { tor: true };
      return c && c !== 'XX' ? { country: c } : {};
    },
  };
}
