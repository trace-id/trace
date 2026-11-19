import { hashComponent, stableStringify } from './hash.js';
import { type SignalPayload } from './types.js';
import { type BrowserFamily, browserFamily, osFamily, platformFamily } from './ua.js';

/**
 * Cross-browser linking: features that describe the device and operating system rather than the browser, so two
 * browsers on one machine produce the same values. Canvas, audio, WebGL parameters and CSS support are left out on
 * purpose: they differ between engines on the same hardware.
 */
export const DEVICE_FEATURES = [
  'os',
  'gpuVendor',
  'gpu',
  'gpuArch',
  'screen',
  'screenLayout',
  'cpu',
  'touch',
  'timezone',
  'language',
  'fonts',
  'voices',
  'displayPrefs',
  'mediaDecode',
  'keyboard',
  'clock',
] as const;

export type DeviceFeature = (typeof DEVICE_FEATURES)[number];

/**
 * Feature values are hashes; the raw readings are never stored. Two plain extras help comparison: which kind of GPU the
 * browser was given, and the installed-fonts bitmap for partial matching.
 */
export type DeviceProfile = Partial<Record<DeviceFeature, string>> & {
  /** 'i' integrated, 'd' discrete. */
  gpuKind?: 'i' | 'd';
  fontsMask?: string;
  /**
   * Device clock offset from the server, in ms, rounded to 100 ms: 0 when within 2 s (a synced clock says nothing), else
   * the offset. Every browser on a device reads the same OS clock.
   */
  clockMs?: number;
};

// Traits a laptop's second GPU changes: ignored when one browser got the integrated GPU and the other the discrete one.
const GPU_TRAITS: ReadonlySet<DeviceFeature> = new Set(['gpu', 'gpuVendor', 'gpuArch', 'mediaDecode']);
const SYNCED_CLOCK_MS = 2000;
const CLOCK_TOLERANCE_MS = 2000;

export interface CrossBrowserConfig {
  weights: Record<DeviceFeature, number>;
  /** If both sides report one of these and it differs, the devices are different, whatever else matches. */
  required: DeviceFeature[];
  /** Share of the total weight both sides must report before a comparison means anything. */
  minSharedWeightRatio: number;
  /** Lowest confidence that is reported as a link. */
  linkThreshold: number;
  /** Lowest link confidence that turns the crossBrowser signal on. */
  signalThreshold: number;
  /**
   * Never link browsers that have not shared a network (IPv4 /24, IPv6 /64) within networkWindowHours. When false,
   * browsers on different networks may still link if their hardware is rare in the project (rareHardwareMaxVisitors).
   * Identical hardware is common (one laptop model across an office, every iPhone of a model), hence the rarity gate.
   */
  requireSharedNetwork: boolean;
  /** Confidence multiplier for rare-hardware links across networks; keep it below signalThreshold so they only inform. */
  otherNetworkFactor: number;
  /** How far back shared networks count: a laptop seen at home in Chrome and at home in Firefox weeks later still links. */
  networkWindowHours: number;
  maxCandidates: number;
  /** A network used by more visitors than this in the window is weaker evidence (offices, campuses, mobile carriers). */
  busyNetworkVisitors: number;
  /** Cross-network links only when at most this many other visitors share the exact hardware core. 0 disables them. */
  rareHardwareMaxVisitors: number;
  rareHardwareMinSimilarity: number;
}

export const DEFAULT_CROSS_BROWSER_CONFIG: CrossBrowserConfig = {
  weights: {
    os: 2,
    gpuVendor: 1,
    gpu: 3,
    gpuArch: 2,
    screen: 2,
    screenLayout: 1,
    cpu: 1,
    touch: 0.5,
    timezone: 1.5,
    language: 0.5,
    fonts: 2.5,
    voices: 1.5,
    displayPrefs: 1,
    mediaDecode: 1,
    keyboard: 1,
    clock: 2,
  },
  required: ['os', 'gpuVendor', 'gpu', 'screen'],
  minSharedWeightRatio: 0.6,
  linkThreshold: 0.7,
  signalThreshold: 0.8,
  requireSharedNetwork: false,
  otherNetworkFactor: 0.75,
  networkWindowHours: 720,
  maxCandidates: 50,
  busyNetworkVisitors: 20,
  rareHardwareMaxVisitors: 3,
  rareHardwareMinSimilarity: 0.95,
};

const GPU_VENDORS: [RegExp, string][] = [
  [/nvidia|geforce|quadro|tesla|rtx|gtx/, 'nvidia'],
  [/\bamd\b|radeon|\bati\b/, 'amd'],
  [/intel|iris|\buhd\b/, 'intel'],
  [/apple|\bm[1-9]\b/, 'apple'],
  [/adreno|qualcomm/, 'qualcomm'],
  [/mali/, 'arm'],
  [/powervr|imagination/, 'imagination'],
  [/swiftshader|llvmpipe|softpipe|basic render/, 'software'],
];

const GPU_NOISE = new Set([
  'angle', 'direct3d11', 'direct3d9', 'd3d11', 'd3d9', 'vs', 'ps', 'opengl', 'engine', 'renderer', 'metal', 'gpu',
  'graphics', 'corporation', 'inc', 'the', 'series', 'family', 'unspecified', 'version', 'or', 'similar', 'pcie',
  'sse2', 'mesa', 'vulkan', 'nvidia', 'amd', 'ati', 'intel', 'apple', 'google', 'microsoft', 'tm', 'r', 'es',
]);

export interface GpuIdentity {
  vendor: string;
  /** Null when the browser hides the real model (Firefox reports a stand-in "…, or similar"; Safari says "Apple GPU"). */
  model: string | null;
}

/**
 * Reduces a WebGL renderer string to vendor and model, so Chrome's
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" and Edge's
 * "NVIDIA GeForce RTX 3060" both become { vendor: "nvidia", model: "3060" }.
 */
export function normalizeGpu(renderer: string | null | undefined): GpuIdentity | null {
  if (!renderer) return null;
  let r = renderer.toLowerCase().trim();
  const sanitized = /,\s*or similar$/.test(r);
  r = r.replace(/,\s*or similar$/, '');
  const angle = /^angle \((.*)\)$/.exec(r);
  if (angle?.[1]) {
    const parts = angle[1].split(',');
    r = parts.length > 1 ? (parts[1] ?? '') : (parts[0] ?? '');
  }
  r = r
    .replace(/\(0x[0-9a-f]+\)/g, ' ')
    .replace(/angle metal renderer:/g, ' ')
    .replace(/\b(vs|ps)_\d_\d\b/g, ' ')
    .replace(/\/.*$/, ' ')
    .replace(/[^a-z0-9 ]/g, ' ');
  const vendor = GPU_VENDORS.find(([re]) => re.test(r))?.[1] ?? 'other';
  const tokens = r.split(/\s+/).filter((t) => t && !GPU_NOISE.has(t) && !/^\d+_\d+$/.test(t));
  const model = sanitized ? '' : (tokens.find((t) => /\d/.test(t)) ?? tokens.slice(0, 2).join(' '));
  if (vendor === 'other' && !model) return null;
  return { vendor, model: model || null };
}

/**
 * Laptops with two GPUs hand different browsers different GPUs (Windows may run Chrome on the discrete NVIDIA and Edge
 * on the integrated AMD or Intel), so an integrated-vs-discrete difference must not rule a device out.
 */
export function gpuKind(gpu: GpuIdentity | null): 'i' | 'd' | undefined {
  if (!gpu) return undefined;
  switch (gpu.vendor) {
    case 'nvidia':
      return 'd';
    case 'amd':
      // "AMD Radeon(TM) Graphics" is the integrated part; discrete Radeons carry a model number (RX 6700, R9 290).
      return gpu.model && /\d/.test(gpu.model) ? 'd' : 'i';
    case 'intel':
      return gpu.model && /^a\d/.test(gpu.model) ? 'd' : 'i';
    case 'qualcomm':
    case 'arm':
    case 'imagination':
      return 'i';
    default:
      return undefined;
  }
}

function popcount(n: number): number {
  let c = 0;
  for (let v = n; v; v &= v - 1) c++;
  return c;
}

/** Jaccard similarity of two hex bitmaps; null when they cannot be compared. */
export function maskSimilarity(a: string, b: string): number | null {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return null;
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16);
    const y = parseInt(b[i]!, 16);
    both += popcount(x & y);
    either += popcount(x | y);
  }
  return either === 0 ? null : both / either;
}

function osOf(payload: SignalPayload): string | null {
  const ua = payload.attributes.userAgent;
  const fromUa = ua ? osFamily(ua) : 'other';
  if (fromUa !== 'other') return fromUa;
  const platform = payload.attributes.platform;
  const fromPlatform = platform ? platformFamily(platform) : 'other';
  return fromPlatform === 'other' ? null : fromPlatform;
}

function put(profile: DeviceProfile, name: DeviceFeature, raw: unknown): void {
  if (raw === null || raw === undefined || raw === '') return;
  profile[name] = hashComponent(`${name}:${stableStringify(raw)}`);
}

export interface DeviceReading {
  profile: DeviceProfile;
  /** Hash of the hardware core (OS, GPU, screen, CPU), for finding candidates on other networks; null if incomplete. */
  coreHash: string | null;
  browser: BrowserFamily;
}

export function clockBucket(offsetMs: number | null | undefined): number | undefined {
  if (offsetMs === null || offsetMs === undefined || !Number.isFinite(offsetMs)) return undefined;
  if (Math.abs(offsetMs) < SYNCED_CLOCK_MS) return 0;
  return Math.round(offsetMs / 100) * 100;
}

export function readDeviceProfile(payload: SignalPayload, extras: { clockOffsetMs?: number | null } = {}): DeviceReading {
  const a = payload.attributes;
  const profile: DeviceProfile = {};
  const os = osOf(payload);
  const gpu = normalizeGpu(a.webglRenderer);
  // Sorted so rotating a phone or tablet does not change it.
  const screen =
    a.screenWidth && a.screenHeight
      ? [Math.min(a.screenWidth, a.screenHeight), Math.max(a.screenWidth, a.screenHeight), a.colorDepth ?? null]
      : null;
  put(profile, 'os', os);
  put(profile, 'gpuVendor', gpu?.vendor);
  put(profile, 'gpu', gpu?.model ? `${gpu.vendor}:${gpu.model}` : null);
  put(profile, 'screen', screen);
  put(profile, 'cpu', a.hardwareConcurrency);
  put(profile, 'touch', a.maxTouchPoints);
  put(profile, 'timezone', a.timezone);
  put(profile, 'language', a.languages[0]?.split('-')[0]?.toLowerCase());
  // Already hashed in the browser; installed fonts are an OS property, so every browser on the machine sees the same set.
  put(profile, 'fonts', payload.components.fonts);
  put(profile, 'voices', payload.device?.voices);
  put(profile, 'displayPrefs', payload.device?.displayPrefs);
  put(profile, 'gpuArch', payload.device?.gpuArch);
  put(profile, 'screenLayout', payload.device?.screenLayout);
  put(profile, 'mediaDecode', payload.device?.mediaDecode);
  put(profile, 'keyboard', payload.device?.keyboard);
  const clock = clockBucket(extras.clockOffsetMs);
  if (clock !== undefined) profile.clockMs = clock;
  const kind = gpuKind(gpu);
  if (kind) profile.gpuKind = kind;
  const mask = payload.device?.fontsMask;
  if (mask) profile.fontsMask = mask;
  const coreHash =
    os && gpu?.model && screen
      ? hashComponent(`core:${stableStringify([os, gpu.vendor, gpu.model, screen, a.hardwareConcurrency])}`)
      : null;
  return { profile, coreHash, browser: a.userAgent ? browserFamily(a.userAgent) : 'other' };
}

/** Weighted share of matching features among those both sides reported; 0 if a required feature differs. */
export function profileSimilarity(a: DeviceProfile, b: DeviceProfile, config: CrossBrowserConfig): number {
  const gpuDiffers = (a.gpuVendor !== b.gpuVendor || a.gpu !== b.gpu) && a.gpuVendor !== undefined && b.gpuVendor !== undefined;
  // One browser on the integrated GPU and the other on the discrete one: possibly one laptop, so the GPU says nothing.
  const hybrid = gpuDiffers && a.gpuKind !== undefined && b.gpuKind !== undefined && a.gpuKind !== b.gpuKind;
  // A clock only says something when at least one side is off by seconds; two synced clocks match every device.
  const clockInformative = a.clockMs !== undefined && b.clockMs !== undefined && (a.clockMs !== 0 || b.clockMs !== 0);
  const skip = (name: DeviceFeature) => (hybrid && GPU_TRAITS.has(name)) || (name === 'clock' && !clockInformative);
  for (const name of config.required) {
    if (skip(name)) continue;
    const left = a[name];
    const right = b[name];
    if (left !== undefined && right !== undefined && left !== right) return 0;
  }
  let total = 0;
  let shared = 0;
  let matched = 0;
  for (const name of DEVICE_FEATURES) {
    const weight = config.weights[name];
    if (weight <= 0 || skip(name)) continue;
    total += weight;
    if (name === 'clock') {
      shared += weight;
      const close = a.clockMs !== 0 && b.clockMs !== 0 && Math.abs(a.clockMs! - b.clockMs!) <= CLOCK_TOLERANCE_MS;
      if (close) matched += weight;
      continue;
    }
    if (name === 'fonts' && a.fontsMask && b.fontsMask) {
      // Partial credit: one font measured differently by one engine should not cost the whole trait.
      const jaccard = maskSimilarity(a.fontsMask, b.fontsMask);
      if (jaccard !== null) {
        shared += weight;
        matched += weight * jaccard;
        continue;
      }
    }
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) continue;
    shared += weight;
    if (left === right) matched += weight;
  }
  if (total === 0 || shared / total < config.minSharedWeightRatio) return 0;
  return matched / shared;
}

/**
 * How much a shared network says: a home router seen by a handful of visitors is strong, a mobile carrier's block seen
 * by hundreds is weak. Two or more distinct shared networks (home and work, say) are strong whatever their size.
 */
export function networkFactor(visitorsOnNetwork: number, sharedNetworks: number, config: CrossBrowserConfig): number {
  if (sharedNetworks >= 2) return 1;
  if (visitorsOnNetwork <= 5) return 1;
  if (visitorsOnNetwork <= config.busyNetworkVisitors) return 0.95;
  if (visitorsOnNetwork <= config.busyNetworkVisitors * 5) return 0.85;
  return 0.75;
}

export function linkConfidence(similarity: number, factor: number): number {
  return Math.round(similarity * factor * 100) / 100;
}
