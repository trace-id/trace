export { createIpIntel, mergeFacts, type IpIntel, type IpIntelOptions } from './combine.js';
export { buildFromEnv, PROVIDERS, providersFromEnv } from './env.js';
export {
  classify,
  instrument,
  pooledSource,
  type KeyState,
  type KeyStrategy,
  type Outcome,
  type PooledSource,
  type PoolKey,
  type PoolOptions,
  type UsageEvent,
} from './pool.js';
export * from './providers.js';
export {
  descriptor,
  needsKey,
  providerIds,
  REGISTRY,
  validateValues,
  type Capability,
  type FieldSpec,
  type ProviderDescriptor,
} from './registry.js';
export { isPublicIp, ProviderError } from './util.js';
export type { FetchOptions, HeaderGetter, IpCacheStore, IpFacts, IpIntelSource, IpIntelStats, LookupContext } from './types.js';
