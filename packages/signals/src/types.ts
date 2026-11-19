import { type NetworkReputation } from './network.js';
import { type IpLocation } from './geo.js';
import { type DeviceRarity } from './rarity.js';
import { type SignedAgent } from './agents.js';
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
  // Added later; older payloads simply do not report them.
  'intl',
  'textMetrics',
  'webglRender',
  'webgpu',
  'apiSurface',
  'systemStyle',
  'codecs',
  'webgl2',
  // Browser extensions and tools whose marks are present in the page (hashed set; absent when none found).
  'extensions',
  // Native apps (React Native SDK): the platform's per-install id, hashed with the app id as salt.
  'appInstall',
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

/** Each value is a hash produced by `hashComponent`, never the raw reading. */
export type Components = Partial<Record<ComponentName, string>>;

/** OS-level readings for cross-browser linking, hashed in the browser. Optional: added after payload v1 shipped. */
export const DEVICE_COMPONENT_NAMES = [
  'voices',
  'displayPrefs',
  'fontsMask',
  'screenLayout',
  'mediaDecode',
  'keyboard',
  'gpuArch',
] as const;
export type DeviceComponentName = (typeof DEVICE_COMPONENT_NAMES)[number];
export type DeviceComponents = Partial<Record<DeviceComponentName, string>>;

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

/**
 * The same readings taken in places a spoofing tool may not patch. Field names, never values, are reported:
 * userAgent, platform, languages, hardwareConcurrency, timezone, webglRenderer, webdriver.
 */
export interface ConsistencyIndicators {
  /** Readings that differ between the page and a Web Worker; null when no worker could run (CSP, old browser). */
  workerMismatch: string[] | null;
  /** Readings that differ between the page and a fresh same-origin iframe; null when no iframe could be made. */
  iframeMismatch: string[] | null;
  /** Date#getTimezoneOffset disagrees with the offset of the Intl time zone. */
  timezoneOffsetMismatch: boolean;
}

/** Short readings sent as is (not hashed): low-entropy codes used by signals. Optional: added after payload v1. */
export interface EnvironmentExtras {
  /** Engine running the page, from built-in error wording: hard to fake from JavaScript. */
  engine: 'blink' | 'gecko' | 'webkit' | 'unknown';
  /** User-Agent Client Hints, Chromium only. */
  uaPlatformVersion: string | null;
  uaArchitecture: string | null;
  uaBitness: string | null;
  uaModel: string | null;
  uaFullVersion: string | null;
  /** Smallest performance.now() step in ms. */
  timerResolutionMs: number | null;
  /** One letter per permission: notifications, geolocation, camera, microphone, persistent-storage, midi, clipboard-read. */
  permissions: string | null;
  /** DevTools protocol serialised a console argument (automation, or DevTools with the console open). */
  cdp: boolean;
  multiScreen: boolean | null;
  gpc: boolean | null;
  doNotTrack: boolean;
  /** Network Information API (Chromium): round-trip estimate in ms, rounded by the browser; 0 in old headless Chrome. */
  connectionRtt?: number | null;
  connectionType?: string | null;
  /** The page runs inside a frame. */
  framed?: boolean;
  /** window.outerWidth x outerHeight. */
  outerSize?: string | null;
  /** A content blocker hid a bait element carrying ad class names (DOM check, no request); null if it could not run. */
  adBlock?: boolean | null;
  /** How many extensions left marks in the page (count only; which ones never leaves the browser). */
  extensionCount?: number;
}

/**
 * Input behaviour between SDK start and identify: counts and timing statistics only, never keys, coordinates or
 * targets. Optional: added after payload v1 shipped.
 */
export interface BehaviorSummary {
  msSinceStart: number;
  pointerMoves: number;
  clicks: number;
  keys: number;
  scrolls: number;
  touches: number;
  /** Pointer, click, key and touch events with isTrusted false: created by page scripts, not by a person. */
  untrusted: number;
  /** Straight-line distance over path length across at least 20 pointer moves; 1 is a ruler-straight path. */
  straightness: number | null;
  /** Standard deviation of intervals between at least 9 key presses. */
  keyIntervalStdMs: number | null;
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
  /** Optional: added after payload v1 shipped. */
  device?: DeviceComponents;
  /** Optional: added after payload v1 shipped. */
  consistency?: ConsistencyIndicators;
  /** Optional: added after payload v1 shipped. */
  env?: EnvironmentExtras;
  /** Optional: added after payload v1 shipped. */
  behavior?: BehaviorSummary;
  /** Present when the payload comes from a native app (React Native SDK) instead of a browser. */
  app?: AppInfo;
  collectMs: number;
}

/** What the React Native SDK reads about the app and device. Low-entropy values in plain form; ids only hashed. */
export interface AppInfo {
  platform: 'ios' | 'android';
  osVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  /** Bundle id (iOS) or application id (Android). */
  appId: string | null;
  appVersion: string | null;
  buildVersion: string | null;
  /** false on an emulator or simulator; null when unknown. */
  isDevice: boolean | null;
  /** Root or jailbreak heuristics (expo-device); null when not checked. */
  rooted: boolean | null;
  /** When the app was first installed on this device (ms since epoch); null when unknown. */
  installedAt: number | null;
}

export interface IpInfo {
  tor: boolean;
  datacenter: boolean;
  blocklisted: boolean;
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
  /** On an operator-supplied privacy-relay list (iCloud Private Relay and similar). Optional: added later. */
  relay?: boolean;
  /** On an operator-supplied VPN range or VPN-provider ASN list. Optional: added later. */
  vpn?: boolean;
  /** On an operator-supplied proxy range list (residential or datacenter proxy exits). Optional: added later. */
  proxy?: boolean;
  /** City-level location, when the GeoIP database is a City edition. Optional: added later. */
  location?: IpLocation | null;
}

export interface VelocityCounts {
  eventsPerVisitor1h: number | null;
  eventsPerVisitor24h: number | null;
  visitorsPerIp1h: number | null;
  ipsPerVisitor24h: number | null;
  visitorsPerLinkedId24h: number | null;
  /** Optional: added later. */
  eventsPerVisitor5m?: number | null;
  /** Distinct IP countries per visitor (needs GeoIP). Optional: added later. */
  countriesPerVisitor24h?: number | null;
  /** Distinct linkedIds per visitor. Optional: added later. */
  linkedIdsPerVisitor24h?: number | null;
}

export interface RequestHeaders {
  userAgent: string | null;
  secChUa: string | null;
  secChUaPlatform: string | null;
  /** Accept-Language request header. Optional: added later. */
  acceptLanguage?: string | null;
}

/** TLS client fingerprint, only when a trusted proxy in front of the server supplies it (TLS_FINGERPRINT_HEADER). */
export interface TlsInfo {
  /** JA4, e.g. t13d1516h2_8daaf6152771_02713d6af862. */
  ja4: string;
  /** Listed in the operator-supplied JA4 blocklist (known bot and scraper clients). */
  blocklisted: boolean;
}

/** Accounts (linkedId) seen with this device, and devices seen with this account, within the window. */
/** The account (linkedId) on this request, as it was before the request: when it was first seen and where. */
export interface AccountHistory {
  /** Earliest time any visitor used this linkedId (ISO); null when this request is its first use. */
  firstSeenAt: string | null;
  /** Whether a browser on this device used this linkedId before. */
  seenOnDevice: boolean;
}

export interface AccountSummary {
  /** Distinct linkedIds on this deviceId, the current one included. */
  accountsOnDevice: number;
  /** Distinct deviceIds for the current linkedId, this one included; null without a linkedId. */
  devicesForAccount: number | null;
}

export interface EvaluationContext {
  payload: SignalPayload;
  headers: RequestHeaders;
  ip: IpInfo;
  velocity: VelocityCounts | null;
  /** Other visitors that look like the same device in another browser or profile; null when linking is off. */
  crossBrowser?: CrossBrowserLinkSummary | null;
  /** Null or absent when the request has no account context (no linkedId ever seen on this device). */
  accounts?: AccountSummary | null;
  /** Null or absent when no trusted proxy supplies a TLS fingerprint. */
  tls?: TlsInfo | null;
  /** Evaluation instant, for time-zone offsets; defaults to now. */
  now?: Date;
  /** A Web Bot Auth signature the server checked (see web-bot-auth.ts). Null or absent when the request was not signed. */
  signedAgent?: SignedAgent | null;
  /** How rare the device's hardware is in this project; null or absent when no statistics are available. */
  rarity?: DeviceRarity | null;
  /** Reverse-DNS check of a claimed search-engine crawler: true confirmed, false failed, null or absent not checked. */
  crawlerVerified?: boolean | null;
  /**
   * Whether this request's nonce was seen before, and how long ago the SDK sent it. Null or absent when the request has
   * no nonce (older SDKs) or the deployment keeps no nonce store.
   */
  replay?: ReplayCheck | null;
  /** Other visitors on this network and how many were flagged; null when cross-browser linking (the network key) is off. */
  network?: NetworkReputation | null;
}

export interface CrossBrowserLinkSummary {
  linkedCount: number;
  topConfidence: number;
  browsers: string[];
}

export interface ReplayCheck {
  nonceSeen: boolean;
  /** Receive time minus the SDK's sentAt; null without sentAt. Large values come from wrong device clocks too. */
  sentAgoMs: number | null;
}
