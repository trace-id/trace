import { descriptor, type ProviderDescriptor, providerIds, REGISTRY } from './registry.js';
import { type FetchOptions, type IpIntelSource } from './types.js';

type Env = Record<string, string | undefined>;

interface ProviderSpec {
  /** Environment variables it reads; the first ones listed are required. */
  required: string[];
  optional: string[];
  build(env: Env, o: FetchOptions): IpIntelSource;
}

/** Builds one provider from environment variables. Throws naming the missing variable. */
export function buildFromEnv(d: ProviderDescriptor, env: Env, o: FetchOptions = {}): IpIntelSource {
  const values: Record<string, string> = {};
  for (const f of d.fields) {
    const v = env[f.env]?.trim();
    if (v) values[f.name] = v;
    else if (f.required) throw new Error(`missing ${f.env}`);
  }
  return d.build(values, o);
}

/** Every provider Trace can use, by the name used in IP_PROVIDERS. Derived from the registry. */
export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = Object.fromEntries(
  REGISTRY.map((d) => [
    d.id,
    {
      required: d.fields.filter((f) => f.required).map((f) => f.env),
      optional: d.fields.filter((f) => !f.required).map((f) => f.env),
      build: (env: Env, o: FetchOptions) => buildFromEnv(d, env, o),
    } satisfies ProviderSpec,
  ]),
);

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
    const d = descriptor(name);
    if (!d) throw new Error(`IP_PROVIDERS: unknown provider "${name}" (known: ${providerIds().join(', ')})`);
    try {
      return buildFromEnv(d, env, o);
    } catch (err) {
      throw new Error(`IP_PROVIDERS: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
