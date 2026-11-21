import {
  abuseipdb,
  cdnHeaders,
  ip2locationIo,
  ipApi,
  ipapiIs,
  ipdata,
  ipgeolocation,
  ipinfo,
  ipqualityscore,
  ipregistry,
  maxmind,
  proxycheck,
  spur,
} from './providers.js';
import { type FetchOptions, type IpIntelSource } from './types.js';

/** What a provider can tell Trace about an address. Which of these a given plan returns varies; see each summary. */
export type Capability = 'country' | 'asn' | 'location' | 'vpn' | 'proxy' | 'tor' | 'datacenter' | 'blocklisted' | 'relay';

export interface FieldSpec {
  /** Name in the values passed to `build`. */
  name: string;
  /** Environment variable that carries it in IP_PROVIDERS mode. */
  env: string;
  label: string;
  /**
   * `key`: belongs to one API key (a provider can have several). `provider`: one value for all keys of the provider
   * (a plan, a threshold).
   */
  scope: 'key' | 'provider';
  /** Masked in the dashboard and never sent back to the browser once saved. */
  secret: boolean;
  required: boolean;
  kind?: 'text' | 'select' | 'boolean' | 'number';
  options?: readonly { value: string; label: string }[];
  /** Pre-selected in the dashboard form. Not applied when building from environment variables. */
  suggested?: string;
  help?: string;
}

/**
 * Everything the server and the dashboard need to know about one provider. Adding a provider means writing its
 * adapter in providers.ts (a mapper and a source) and one entry in REGISTRY below. The form, the key pool, the
 * usage counters and the docs table follow from the entry.
 */
export interface ProviderDescriptor {
  /** The name used in IP_PROVIDERS and stored with a dashboard provider. */
  id: string;
  label: string;
  website: string;
  summary: string;
  /** What the free plan gives, as far as we know. Plans change: the dashboard tells people to check the provider. */
  freeNote?: string;
  provides: readonly Capability[];
  fields: readonly FieldSpec[];
  /** False for sources that read the request instead of calling an API (the CDN header). They take no keys. */
  remote: boolean;
  /** Rules across fields that a single field cannot express. Returns a message, or null when the values are fine. */
  check?(values: Readonly<Record<string, string>>): string | null;
  /** Values by field name: the provider-scope fields plus one key's fields. Throws a readable error when invalid. */
  build(values: Readonly<Record<string, string>>, o: FetchOptions): IpIntelSource;
}

type Values = Readonly<Record<string, string>>;

const need = (v: Values, name: string): string => {
  const x = v[name]?.trim();
  if (!x) throw new Error(`missing ${name}`);
  return x;
};
const opt = (v: Values, name: string): string | undefined => v[name]?.trim() || undefined;
const bool = (v: Values, name: string): boolean => v[name] === 'true';

const keyField = (over: Partial<FieldSpec> & Pick<FieldSpec, 'name' | 'env' | 'label'>): FieldSpec => ({
  scope: 'key',
  secret: true,
  required: true,
  kind: 'text',
  ...over,
});

export const REGISTRY: readonly ProviderDescriptor[] = [
  {
    id: 'ipinfo',
    label: 'ipinfo',
    website: 'https://ipinfo.io',
    summary: 'Lite returns country and ASN. Core adds location, hosting and one anonymity flag, reported as VPN.',
    freeNote: 'The Lite plan is free: country and ASN only.',
    provides: ['country', 'asn', 'location', 'vpn', 'datacenter'],
    remote: true,
    fields: [
      keyField({ name: 'token', env: 'IPINFO_TOKEN', label: 'Access token' }),
      {
        name: 'plan', env: 'IPINFO_PLAN', label: 'Plan', scope: 'provider', secret: false, required: false, kind: 'select', suggested: 'lite',
        options: [{ value: 'lite', label: 'Lite (free)' }, { value: 'core', label: 'Core (paid)' }],
        help: 'Lite and Core use different endpoints. A free token on the Core setting returns nothing.',
      },
    ],
    build: (v, o) => ipinfo({ ...o, token: need(v, 'token'), plan: v.plan === 'lite' ? 'lite' : 'core' }),
  },
  {
    id: 'ipqualityscore',
    label: 'IPQualityScore',
    website: 'https://www.ipqualityscore.com',
    summary: 'VPN, proxy and Tor verdicts, recent abuse, country, ASN and location.',
    freeNote: 'A free monthly allowance on sign-up.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'blocklisted'],
    remote: true,
    fields: [
      keyField({ name: 'key', env: 'IPQS_KEY', label: 'API key' }),
      {
        name: 'strictness', env: 'IPQS_STRICTNESS', label: 'Strictness', scope: 'provider', secret: false, required: false, kind: 'select', suggested: '1',
        options: [{ value: '0', label: '0 (lenient)' }, { value: '1', label: '1 (default)' }, { value: '2', label: '2' }, { value: '3', label: '3 (strict, more false alarms)' }],
      },
    ],
    build: (v, o) => ipqualityscore({ ...o, key: need(v, 'key'), strictness: (Number(v.strictness ?? 1) as 0 | 1 | 2 | 3) || 0 }),
  },
  {
    id: 'maxmind',
    label: 'MaxMind web services',
    website: 'https://www.maxmind.com',
    summary: 'GeoIP Country, City Plus or Insights. Insights adds VPN, proxy, Tor and hosting flags.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'datacenter'],
    remote: true,
    fields: [
      keyField({ name: 'accountId', env: 'MAXMIND_ACCOUNT_ID', label: 'Account ID', secret: false }),
      keyField({ name: 'licenseKey', env: 'MAXMIND_LICENSE_KEY', label: 'License key' }),
      {
        name: 'service', env: 'MAXMIND_SERVICE', label: 'Service', scope: 'provider', secret: false, required: false, kind: 'select', suggested: 'insights',
        options: [{ value: 'country', label: 'Country' }, { value: 'city', label: 'City Plus' }, { value: 'insights', label: 'Insights' }],
      },
    ],
    build: (v, o) => {
      const service = v.service || 'insights';
      if (!['country', 'city', 'insights'].includes(service)) throw new Error('service must be country, city or insights');
      return maxmind({ ...o, accountId: need(v, 'accountId'), licenseKey: need(v, 'licenseKey'), service: service as 'country' | 'city' | 'insights' });
    },
  },
  {
    id: 'ipdata',
    label: 'ipdata',
    website: 'https://ipdata.co',
    summary: 'Country, ASN, location, Tor, proxy, relay, datacenter and known attackers. VPN needs a Business plan.',
    freeNote: 'A free tier with a daily request limit.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'datacenter', 'blocklisted', 'relay'],
    remote: true,
    fields: [keyField({ name: 'key', env: 'IPDATA_KEY', label: 'API key' })],
    build: (v, o) => ipdata({ ...o, key: need(v, 'key') }),
  },
  {
    id: 'ipapi.is',
    label: 'ipapi.is',
    website: 'https://ipapi.is',
    summary: 'Country, ASN, location, VPN, Tor, proxy, datacenter and abusers.',
    freeNote: 'A small free allowance.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'datacenter', 'blocklisted'],
    remote: true,
    fields: [keyField({ name: 'key', env: 'IPAPI_IS_KEY', label: 'API key' })],
    build: (v, o) => ipapiIs({ ...o, key: need(v, 'key') }),
  },
  {
    id: 'ip2location.io',
    label: 'IP2Location.io',
    website: 'https://www.ip2location.io',
    summary: 'Country, ASN, location and proxy. VPN, Tor and datacenter need the Security plan.',
    freeNote: 'A limited free plan.',
    provides: ['country', 'asn', 'location', 'proxy', 'vpn', 'tor', 'datacenter'],
    remote: true,
    fields: [keyField({ name: 'key', env: 'IP2LOCATION_IO_KEY', label: 'API key' })],
    build: (v, o) => ip2locationIo({ ...o, key: need(v, 'key') }),
  },
  {
    id: 'ipregistry',
    label: 'ipregistry',
    website: 'https://ipregistry.co',
    summary: 'Country, ASN, location, VPN, Tor exit, proxy, relay, cloud provider and threats.',
    freeNote: 'Free credits on sign-up.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'datacenter', 'blocklisted', 'relay'],
    remote: true,
    fields: [keyField({ name: 'key', env: 'IPREGISTRY_KEY', label: 'API key' })],
    build: (v, o) => ipregistry({ ...o, key: need(v, 'key') }),
  },
  {
    id: 'proxycheck',
    label: 'proxycheck.io',
    website: 'https://proxycheck.io',
    summary: 'Country, ASN, location, and VPN, Tor or other proxy by detected type.',
    freeNote: 'A free tier with a daily query limit; a free key raises it.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor'],
    remote: true,
    fields: [keyField({ name: 'key', env: 'PROXYCHECK_KEY', label: 'API key (optional)', required: false })],
    build: (v, o) => proxycheck({ ...o, ...(opt(v, 'key') ? { key: need(v, 'key') } : {}) }),
  },
  {
    id: 'spur',
    label: 'Spur',
    website: 'https://spur.us',
    summary: 'Country, ASN, VPN, residential and callback proxies, Tor and datacenter.',
    provides: ['country', 'asn', 'vpn', 'proxy', 'tor', 'datacenter'],
    remote: true,
    fields: [keyField({ name: 'token', env: 'SPUR_TOKEN', label: 'API token' })],
    build: (v, o) => spur({ ...o, token: need(v, 'token') }),
  },
  {
    id: 'abuseipdb',
    label: 'AbuseIPDB',
    website: 'https://www.abuseipdb.com',
    summary: 'Country, Tor and hosting; reports an address as blocklisted at or above an abuse confidence score.',
    freeNote: 'A free key with a daily limit.',
    provides: ['country', 'tor', 'datacenter', 'blocklisted'],
    remote: true,
    fields: [
      keyField({ name: 'key', env: 'ABUSEIPDB_KEY', label: 'API key' }),
      { name: 'minScore', env: 'ABUSEIPDB_MIN_SCORE', label: 'Blocklist at score', scope: 'provider', secret: false, required: false, kind: 'number', suggested: '75', help: 'Abuse confidence score from 0 to 100.' },
    ],
    build: (v, o) => abuseipdb({ ...o, key: need(v, 'key'), minScore: Number(v.minScore || 75) }),
  },
  {
    id: 'ipgeolocation',
    label: 'ipgeolocation.io',
    website: 'https://ipgeolocation.io',
    summary: 'Country, ASN and location. With the security add-on: VPN, Tor, proxy, cloud and attackers.',
    freeNote: 'The free plan covers location; the security add-on is paid.',
    provides: ['country', 'asn', 'location', 'vpn', 'proxy', 'tor', 'datacenter', 'blocklisted'],
    remote: true,
    fields: [
      keyField({ name: 'key', env: 'IPGEOLOCATION_KEY', label: 'API key' }),
      { name: 'security', env: 'IPGEOLOCATION_SECURITY', label: 'Security add-on', scope: 'provider', secret: false, required: false, kind: 'boolean', help: 'Turn on only if your plan includes the security data; otherwise the request fails.' },
    ],
    build: (v, o) => ipgeolocation({ ...o, key: need(v, 'key'), security: bool(v, 'security') }),
  },
  {
    id: 'ip-api',
    label: 'ip-api.com',
    website: 'https://ip-api.com',
    summary: 'Country, ASN, location, proxy and hosting. The pro endpoint uses HTTPS.',
    freeNote: 'The free endpoint is HTTP only and not for commercial use.',
    provides: ['country', 'asn', 'location', 'proxy', 'datacenter'],
    remote: true,
    fields: [
      keyField({ name: 'key', env: 'IP_API_KEY', label: 'Pro key (optional)', required: false }),
      { name: 'allowFreeHttp', env: 'IP_API_ALLOW_FREE_HTTP', label: 'Use the free HTTP endpoint', scope: 'provider', secret: false, required: false, kind: 'boolean', help: 'Visitor IPs travel unencrypted. Only for non-commercial use.' },
    ],
    check: (v) => (opt(v, 'key') || bool(v, 'allowFreeHttp') ? null : 'Add a pro key, or turn on the free HTTP endpoint'),
    build: (v, o) => ipApi({ ...o, ...(opt(v, 'key') ? { key: need(v, 'key') } : {}), allowFreeHttp: bool(v, 'allowFreeHttp') }),
  },
  {
    id: 'cdn-headers',
    label: 'CDN country header',
    website: 'https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-ipcountry',
    summary: 'Country (and Tor on Cloudflare) from a header your CDN sets. Free and instant, but only safe when the CDN is the only way in.',
    freeNote: 'Free.',
    provides: ['country', 'tor'],
    remote: false,
    fields: [
      { name: 'countryHeader', env: 'IP_COUNTRY_HEADER', label: 'Header name', scope: 'provider', secret: false, required: true, kind: 'text', suggested: 'cf-ipcountry', help: 'For example cf-ipcountry, x-vercel-ip-country or cloudfront-viewer-country.' },
    ],
    build: (v) => cdnHeaders({ countryHeader: need(v, 'countryHeader') }),
  },
];

const BY_ID = new Map(REGISTRY.map((d) => [d.id, d]));

export const providerIds = (): string[] => REGISTRY.map((d) => d.id);

export function descriptor(id: string): ProviderDescriptor | undefined {
  return BY_ID.get(id);
}

/** True when a provider cannot work without a key (an API provider with a required key-scope field). */
export function needsKey(d: ProviderDescriptor): boolean {
  return d.remote && d.fields.some((f) => f.scope === 'key' && f.required);
}

/** Checks values against a descriptor's fields; returns one message per problem (empty when valid). */
export function validateValues(d: ProviderDescriptor, values: Readonly<Record<string, unknown>>, scope: 'key' | 'provider' | 'all' = 'all'): string[] {
  const problems: string[] = [];
  for (const f of d.fields) {
    if (scope !== 'all' && f.scope !== scope) continue;
    const raw = values[f.name];
    const v = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : String(raw);
    if (!v) {
      if (f.required) problems.push(`${f.label} is required`);
      continue;
    }
    if (v.length > 512) problems.push(`${f.label} is too long`);
    if (f.kind === 'select' && f.options && !f.options.some((o) => o.value === v)) problems.push(`${f.label} must be one of ${f.options.map((o) => o.value).join(', ')}`);
    if (f.kind === 'boolean' && v !== 'true' && v !== 'false') problems.push(`${f.label} must be true or false`);
    if (f.kind === 'number' && !Number.isFinite(Number(v))) problems.push(`${f.label} must be a number`);
  }
  if (problems.length === 0 && scope === 'all' && d.check) {
    const strings = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v)]));
    const message = d.check(strings);
    if (message) problems.push(message);
  }
  return problems;
}
