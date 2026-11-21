/** Shapes returned by the server's /v1/ip-intel and /v1/instance routes. Keys are never part of any of them. */

export type Capability = 'country' | 'asn' | 'location' | 'vpn' | 'proxy' | 'tor' | 'datacenter' | 'blocklisted' | 'relay';

export interface FieldSpec {
  name: string;
  env: string;
  label: string;
  scope: 'key' | 'provider';
  secret: boolean;
  required: boolean;
  kind?: 'text' | 'select' | 'boolean' | 'number';
  options?: { value: string; label: string }[];
  suggested?: string;
  help?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  website: string;
  summary: string;
  freeNote?: string;
  provides: Capability[];
  fields: FieldSpec[];
  remote: boolean;
}

export interface KeyView {
  id: string;
  label: string;
  hint: string;
  enabled: boolean;
  weight: number;
  dailyLimit: number | null;
  usedToday: number;
  coolingUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  broken: string | null;
  createdAt: string;
}

export type ProviderStatus = 'ok' | 'degraded' | 'down' | 'disabled';

export interface ProviderView {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  priority: number;
  sharePercent: number;
  dailyLimit: number | null;
  strategy: 'weighted' | 'failover';
  settings: Record<string, string>;
  keys: KeyView[];
  usedToday: number;
  status: ProviderStatus;
  statusDetail: string | null;
  createdAt: string;
}

export interface UsageTotals {
  requests: number;
  ok: number;
  errors: number;
  rateLimited: number;
  authFailed: number;
  skipped: number;
  avgLatencyMs: number | null;
}

export interface UsagePoint extends UsageTotals {
  day: string;
  providerRef: string;
  keyRef: string;
  provider: string;
}

export interface SettingView {
  key: string;
  group: string;
  label: string;
  help: string;
  kind: 'number' | 'boolean' | 'text' | 'secret';
  min?: number;
  max?: number;
  value: string | number | boolean | null;
  isSet: boolean;
  source: 'dashboard' | 'environment' | 'default';
  fallback: string | number | boolean | null;
  restart: boolean;
}

export interface IpOverview {
  registry: ProviderInfo[];
  providers: ProviderView[];
  environment: { ref: string; provider: string; usage: UsageTotals }[];
  cache: {
    redis: boolean;
    sharedEnabled: boolean;
    ttlHours: number;
    timeoutMs: number;
    lookups: number;
    memoryHits: number;
    sharedHits: number;
    providerCalls: number;
    failures: number;
    skippedPrivate: number;
  };
  files: Record<string, number | boolean> | null;
  settings: SettingView[];
  totalsToday: UsageTotals;
  canReload: boolean;
}

export interface UsageResponse {
  points: UsagePoint[];
  byProvider: Record<string, UsageTotals>;
  byKey: Record<string, UsageTotals>;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  facts?: Record<string, unknown>;
  error?: string;
  status?: number | null;
}
