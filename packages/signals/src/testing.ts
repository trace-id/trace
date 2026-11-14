import { type ScoringConfig } from './config.js';
import {
  type BotIndicators,
  type Components,
  type DeviceAttributes,
  type EvaluationContext,
  type IpInfo,
  type PrivacyIndicators,
  type SignalPayload,
  type TamperIndicators,
} from './types.js';

export interface PayloadOverrides {
  components?: Components;
  attributes?: Partial<DeviceAttributes>;
  bot?: Partial<BotIndicators>;
  tamper?: Partial<TamperIndicators>;
  privacy?: Partial<PrivacyIndicators>;
}

export const TEST_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** A clean desktop Chrome payload; override only what a test cares about. */
export function makePayload(overrides: PayloadOverrides = {}): SignalPayload {
  return {
    v: 1,
    components: overrides.components ?? {
      canvas: 'c1',
      webgl: 'w1',
      webglParams: 'wp1',
      audio: 'a1',
      fonts: 'f1',
      screen: 's1',
      hardware: 'h1',
      timezone: 'tz1',
      languages: 'l1',
      platform: 'p1',
      math: 'm1',
      css: 'css1',
      media: 'md1',
      userAgentFamily: 'ua1',
    },
    attributes: {
      screenWidth: 1920,
      screenHeight: 1080,
      availWidth: 1920,
      availHeight: 1040,
      colorDepth: 24,
      pixelRatio: 1,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      timezone: 'Europe/Berlin',
      languages: ['en-US', 'en'],
      platform: 'Win32',
      userAgent: TEST_USER_AGENT,
      uaBrands: [{ brand: 'Chromium', version: '130' }],
      uaMobile: false,
      uaPlatform: 'Windows',
      webglVendor: 'Google Inc. (NVIDIA)',
      webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ...overrides.attributes,
    },
    bot: {
      webdriver: false,
      headlessUserAgent: false,
      automationGlobals: [],
      noPlugins: false,
      noLanguages: false,
      permissionsInconsistent: false,
      chromeObjectMissing: false,
      zeroOuterSize: false,
      ...overrides.bot,
    },
    tamper: {
      nativeOverrides: [],
      navigatorOwnProperties: [],
      uaPlatformMismatch: false,
      uaFeatureMismatch: false,
      canvasNoise: false,
      ...overrides.tamper,
    },
    privacy: {
      incognitoLikely: false,
      incognitoMethod: null,
      storageQuotaMb: 2048,
      ...overrides.privacy,
    },
    storage: { cookie: true, localStorage: true, indexedDb: true },
    collectMs: 42,
  };
}

export const CLEAN_IP: IpInfo = {
  tor: false,
  datacenter: false,
  blocklisted: false,
  country: null,
  asn: null,
  asnOrg: null,
};

export function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    payload: overrides.payload ?? makePayload(),
    headers: overrides.headers ?? { userAgent: TEST_USER_AGENT, secChUa: null, secChUaPlatform: null },
    ip: overrides.ip ?? CLEAN_IP,
    velocity: overrides.velocity ?? null,
  };
}

export const TEST_SCORING_CONFIG: ScoringConfig = {
  version: 1,
  identification: {
    matchThreshold: 0.9,
    tokenAgreementThreshold: 0.6,
    minSharedWeightRatio: 0.5,
    ambiguityMargin: 0.1,
    maxCandidates: 50,
    componentWeights: {
      canvas: 3,
      webgl: 3,
      webglParams: 2,
      audio: 2,
      fonts: 3,
      screen: 1.5,
      hardware: 1.5,
      timezone: 1,
      languages: 1,
      platform: 1,
      math: 1,
      css: 0.5,
      media: 0.5,
      userAgentFamily: 2,
    },
    buckets: [
      ['canvas', 'webgl', 'audio'],
      ['screen', 'hardware', 'timezone', 'platform'],
      ['fonts', 'webglParams', 'languages'],
    ],
  },
  suspect: {
    weights: { bot: 60, tampering: 25, tor: 30, datacenterIp: 15, ipBlocklist: 40, velocity: 20, incognito: 5 },
  },
  velocity: { eventsPerVisitor1h: 60, visitorsPerIp1h: 20, ipsPerVisitor24h: 10, visitorsPerLinkedId24h: 5 },
};
