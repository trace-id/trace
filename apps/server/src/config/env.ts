import { z } from 'zod';

const optionalPath = z.string().min(1).optional();
const perMinute = (fallback: number) => z.coerce.number().int().min(1).max(1_000_000).default(fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  TOKEN_SECRET: z.string().min(32, 'TOKEN_SECRET must be at least 32 characters'),
  TRUST_PROXY: z.string().default('false'),
  SCORING_CONFIG_PATH: optionalPath,
  IP_STORAGE: z.enum(['full', 'truncated', 'hashed', 'none']).default('truncated'),
  EVENT_VERIFY_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  TOR_EXIT_LIST_FILE: optionalPath,
  DATACENTER_CIDR_FILE: optionalPath,
  IP_BLOCKLIST_FILE: optionalPath,
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
