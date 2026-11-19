import { z } from 'zod';

const optionalPath = z.string().min(1).optional();
const perMinute = (fallback: number) => z.coerce.number().int().min(1).max(1_000_000).default(fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(5000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  TOKEN_SECRET: z.string().min(32, 'TOKEN_SECRET must be at least 32 characters'),
  TRUST_PROXY: z.string().default('false'),
  SCORING_CONFIG_PATH: optionalPath,
  IP_STORAGE: z.enum(['full', 'truncated', 'hashed', 'none']).default('truncated'),
  EVENT_VERIFY_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  TOR_EXIT_LIST_FILE: optionalPath,
  DATACENTER_CIDR_FILE: optionalPath,
  IP_BLOCKLIST_FILE: optionalPath,
  DATACENTER_ASN_FILE: optionalPath,
  /** Operator-supplied MaxMind-format databases; never bundled. */
  GEOIP_COUNTRY_DB: optionalPath,
  GEOIP_ASN_DB: optionalPath,
  /** Privacy relay egress ranges (Apple publishes iCloud Private Relay's as CSV; first column is read). */
  RELAY_CIDR_FILE: optionalPath,
  /** Commercial VPN exit ranges, one IP or CIDR per line. */
  VPN_CIDR_FILE: optionalPath,
  /** VPN provider ASNs, one per line (needs GEOIP_ASN_DB). */
  VPN_ASN_FILE: optionalPath,
  /** Residential and datacenter proxy exit ranges, one IP or CIDR per line: the proxy signal. */
  PROXY_CIDR_FILE: optionalPath,
  CRAWLER_RANGES_FILE: optionalPath,
  /** Budget for IP provider lookups (IP_PROVIDERS) per identify, in ms; past it they read as "not checked". */
  IP_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(50).max(5000).default(400),
  /** How long a provider's answer for an IP is reused. 0 turns caching off. */
  IP_PROVIDER_CACHE_HOURS: z.coerce.number().min(0).max(720).default(24),
  /** Base64 of 32 random bytes. When set, identify responses carry sealedResult: the full event, AES-256-GCM encrypted. */
  SEALED_RESULTS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'SEALED_RESULTS_KEY must be base64 of exactly 32 bytes')
    .optional(),
  RATE_LIMIT_INGEST_PER_KEY_PER_MIN: perMinute(1200),
  RATE_LIMIT_INGEST_PER_IP_PER_MIN: perMinute(60),
  RATE_LIMIT_INGEST_PER_VISITOR_PER_MIN: perMinute(30),
  RATE_LIMIT_API_PER_KEY_PER_MIN: perMinute(600),
  RETENTION_MAX_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  MAINTENANCE_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(360),
  /** Development only: allows http:// webhook URLs and private/loopback targets. */
  WEBHOOK_ALLOW_INSECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5000),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  /** Link visitors that look like one device in different browsers (see docs/privacy.md). Off when IP_STORAGE=none. */
  CROSS_BROWSER_LINKING: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /**
   * First-party mode: identify responses also set the visitor token as an HttpOnly, SameSite=Lax cookie. Browsers only
   * keep it when the SDK runs with firstPartyCookie: true and this server is same-site with the page (a path or
   * subdomain of the customer's site; see docs/integration.md). Never a third-party cookie.
   */
  VISITOR_COOKIE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  VISITOR_COOKIE_NAME: z.string().regex(/^[\w-]{1,64}$/).default('_trace_vt'),
  /** Optional Domain attribute, e.g. example.com to share the cookie across subdomains. */
  VISITOR_COOKIE_DOMAIN: z.string().regex(/^[a-z0-9.-]{1,253}$/i).optional(),
  /** Cookie Path. Behind a path proxy (www.example.com/trace -> this server) set it to /trace/v1/identify. */
  VISITOR_COOKIE_PATH: z.string().regex(/^\/[\w./-]{0,200}$/).default('/v1/identify'),
  /**
   * Header with the JA4 TLS fingerprint, set by a proxy you control that terminates TLS (and strips the header from
   * client requests). Unset: TLS signals are off.
   */
  TLS_FINGERPRINT_HEADER: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  /**
   * Web Bot Auth key directories to trust for signed AI agents, comma separated origins. Default https://chatgpt.com;
   * "*" trusts any https origin (Trace then fetches whatever directory a request names); "off" disables the check.
   */
  AGENT_DIRECTORIES: z.string().default('https://chatgpt.com'),
  /** One JA4 per line, '#' comments allowed: known bot and scraper clients. */
  JA4_BLOCKLIST_FILE: optionalPath,
  /** Signs dashboard sessions. At least 32 random characters, different from TOKEN_SECRET. */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  /** Public origin of the dashboard; it proxies /api/auth and /v1 to this server. */
  DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  /** After the first account exists, further sign-ups are refused unless this is true. */
  DASHBOARD_ALLOW_SIGNUP: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

/** Reports which variables are invalid, never their values. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}

/**
 * `false` (default), `true` (trust every hop: only behind a proxy you control that strips
 * client-sent X-Forwarded-For), or a comma list of proxy IPs/CIDRs. Hop counts are refused:
 * they let clients spoof their IP by prepending addresses.
 */
export function parseTrustProxy(value: string): boolean | string[] {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY hop counts are not supported; list your proxy IPs or CIDRs instead');
  }
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
