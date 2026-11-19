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

type Env = Record<string, string | undefined>;

interface ProviderSpec {
  /** Environment variables it reads; the first ones listed are required. */
  required: string[];
  optional: string[];
  build(env: Env, o: FetchOptions): IpIntelSource;
}

const need = (env: Env, name: string): string => {
  const v = env[name]?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
};

/** Every provider Trace can use, by the name used in IP_PROVIDERS. */
export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = {
  ipinfo: {
    required: ['IPINFO_TOKEN'],
    optional: ['IPINFO_PLAN'],
    build: (e, o) => ipinfo({ ...o, token: need(e, 'IPINFO_TOKEN'), plan: e.IPINFO_PLAN === 'lite' ? 'lite' : 'core' }),
  },
  ipqualityscore: {
    required: ['IPQS_KEY'],
    optional: ['IPQS_STRICTNESS'],
    build: (e, o) => ipqualityscore({ ...o, key: need(e, 'IPQS_KEY'), strictness: (Number(e.IPQS_STRICTNESS ?? 1) as 0 | 1 | 2 | 3) || 0 }),
  },
  maxmind: {
    required: ['MAXMIND_ACCOUNT_ID', 'MAXMIND_LICENSE_KEY'],
    optional: ['MAXMIND_SERVICE'],
    build: (e, o) => {
      const service = e.MAXMIND_SERVICE ?? 'insights';
      if (!['country', 'city', 'insights'].includes(service)) throw new Error('MAXMIND_SERVICE must be country, city or insights');
      return maxmind({ ...o, accountId: need(e, 'MAXMIND_ACCOUNT_ID'), licenseKey: need(e, 'MAXMIND_LICENSE_KEY'), service: service as 'country' | 'city' | 'insights' });
    },
  },
  ipdata: { required: ['IPDATA_KEY'], optional: [], build: (e, o) => ipdata({ ...o, key: need(e, 'IPDATA_KEY') }) },
  'ipapi.is': { required: ['IPAPI_IS_KEY'], optional: [], build: (e, o) => ipapiIs({ ...o, key: need(e, 'IPAPI_IS_KEY') }) },
  'ip2location.io': { required: ['IP2LOCATION_IO_KEY'], optional: [], build: (e, o) => ip2locationIo({ ...o, key: need(e, 'IP2LOCATION_IO_KEY') }) },
  ipregistry: { required: ['IPREGISTRY_KEY'], optional: [], build: (e, o) => ipregistry({ ...o, key: need(e, 'IPREGISTRY_KEY') }) },
  proxycheck: { required: [], optional: ['PROXYCHECK_KEY'], build: (e, o) => proxycheck({ ...o, ...(e.PROXYCHECK_KEY ? { key: e.PROXYCHECK_KEY } : {}) }) },
  spur: { required: ['SPUR_TOKEN'], optional: [], build: (e, o) => spur({ ...o, token: need(e, 'SPUR_TOKEN') }) },
  abuseipdb: {
    required: ['ABUSEIPDB_KEY'],
    optional: ['ABUSEIPDB_MIN_SCORE'],
    build: (e, o) => abuseipdb({ ...o, key: need(e, 'ABUSEIPDB_KEY'), minScore: Number(e.ABUSEIPDB_MIN_SCORE ?? 75) }),
  },
  ipgeolocation: {
    required: ['IPGEOLOCATION_KEY'],
    optional: ['IPGEOLOCATION_SECURITY'],
    build: (e, o) => ipgeolocation({ ...o, key: need(e, 'IPGEOLOCATION_KEY'), security: e.IPGEOLOCATION_SECURITY === 'true' }),
  },
  'ip-api': {
    required: [],
    optional: ['IP_API_KEY', 'IP_API_ALLOW_FREE_HTTP'],
    build: (e, o) => ipApi({ ...o, ...(e.IP_API_KEY ? { key: e.IP_API_KEY } : {}), allowFreeHttp: e.IP_API_ALLOW_FREE_HTTP === 'true' }),
  },
  'cdn-headers': { required: ['IP_COUNTRY_HEADER'], optional: [], build: (e) => cdnHeaders({ countryHeader: need(e, 'IP_COUNTRY_HEADER') }) },
};

/**
 * Sources from IP_PROVIDERS (comma separated, in priority order) and each provider's variables. Throws naming the
 * missing variable, so a misconfigured server fails at startup instead of silently checking nothing.
 */
export function providersFromEnv(env: Env, o: FetchOptions = {}): IpIntelSource[] {
  const names = (env.IP_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return names.map((name) => {
    const spec = PROVIDERS[name];
    if (!spec) throw new Error(`IP_PROVIDERS: unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
    try {
      return spec.build(env, o);
    } catch (err) {
      throw new Error(`IP_PROVIDERS: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
