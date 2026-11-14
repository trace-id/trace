export const PAYLOAD_VERSION = 1;

export const COMPONENT_NAMES = [
  'canvas',
  'webgl',
  'webglParams',
  'audio',
  'fonts',
  'screen',
  'hardware',
  'timezone',
  'languages',
  'platform',
  'math',
  'css',
  'media',
  'userAgentFamily',
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

/** Each value is a hash produced by `hashComponent`, never the raw reading. */
export type Components = Partial<Record<ComponentName, string>>;

export interface UaBrand {
  brand: string;
  version: string;
}

export interface DeviceAttributes {
  screenWidth: number | null;
  screenHeight: number | null;
  availWidth: number | null;
  availHeight: number | null;
  colorDepth: number | null;
  pixelRatio: number | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number | null;
  timezone: string | null;
  languages: string[];
  platform: string | null;
  userAgent: string | null;
  uaBrands: UaBrand[];
  uaMobile: boolean | null;
  uaPlatform: string | null;
  webglVendor: string | null;
  webglRenderer: string | null;
}

export interface BotIndicators {
  webdriver: boolean;
  headlessUserAgent: boolean;
  automationGlobals: string[];
  noPlugins: boolean;
  noLanguages: boolean;
  permissionsInconsistent: boolean;
  chromeObjectMissing: boolean;
  zeroOuterSize: boolean;
}

export interface TamperIndicators {
  nativeOverrides: string[];
  navigatorOwnProperties: string[];
  uaPlatformMismatch: boolean;
  uaFeatureMismatch: boolean;
  canvasNoise: boolean;
}

export interface PrivacyIndicators {
  incognitoLikely: boolean;
  incognitoMethod: string | null;
  storageQuotaMb: number | null;
  /** navigator.brave present. Optional: added after payload v1 shipped. */
  braveLikely?: boolean;
}

export interface DevtoolsIndicators {
  likely: boolean;
  method: string | null;
}

export interface StorageAvailability {
  cookie: boolean;
  localStorage: boolean;
  indexedDb: boolean;
}

export interface SignalPayload {
  v: typeof PAYLOAD_VERSION;
  components: Components;
  attributes: DeviceAttributes;
  bot: BotIndicators;
  tamper: TamperIndicators;
  privacy: PrivacyIndicators;
  storage: StorageAvailability;
  /** Optional: added after payload v1 shipped. */
  devtools?: DevtoolsIndicators;
  collectMs: number;
}

export interface IpInfo {
  tor: boolean;
  datacenter: boolean;
  blocklisted: boolean;
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
}

export interface VelocityCounts {
  eventsPerVisitor1h: number | null;
  eventsPerVisitor24h: number | null;
  visitorsPerIp1h: number | null;
  ipsPerVisitor24h: number | null;
  visitorsPerLinkedId24h: number | null;
}

export interface RequestHeaders {
  userAgent: string | null;
  secChUa: string | null;
  secChUaPlatform: string | null;
}

export interface EvaluationContext {
  payload: SignalPayload;
  headers: RequestHeaders;
  ip: IpInfo;
  velocity: VelocityCounts | null;
}
