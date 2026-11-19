import { gpuCapabilities } from './extended.js';
import { safe, safeAsync } from './safe.js';

/**
 * Readings that come from the operating system rather than the browser, used to link browsers on one device.
 * Only the hashes leave the page (see collect.ts).
 */

// Supported by Chromium, Firefox and Safari alike, and set by the OS or the display, not by the browser.
const OS_MEDIA_QUERIES = [
  '(color-gamut: srgb)',
  '(color-gamut: p3)',
  '(pointer: fine)',
  '(pointer: coarse)',
  '(any-pointer: coarse)',
  '(hover: hover)',
  '(prefers-reduced-motion: reduce)',
  '(forced-colors: active)',
];

export function readDisplayPrefs(): string | null {
  return safe(() => {
    if (typeof matchMedia !== 'function') return null;
    return OS_MEDIA_QUERIES.map((q) => (matchMedia(q).matches ? '1' : '0')).join('');
  }, null);
}

/**
 * "Microsoft David - English (United States)" (Chromium) and "Microsoft David Desktop - English (United States)"
 * (Firefox, SAPI) both become "microsoft david". Network voices (Google, Edge "Online (Natural)") are skipped:
 * they come with the browser, not the OS.
 */
export function normalizeVoiceName(name: string): string {
  return name
    .toLowerCase()
    .split(' - ')[0]!
    .replace(/\bdesktop\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function localVoices(): string | null {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const names = [...new Set(voices.filter((v) => v.localService).map((v) => normalizeVoiceName(v.name)))]
    .filter(Boolean)
    .sort();
  return names.length > 0 ? names.join('|') : null;
}

/** Installed text-to-speech voices. Chromium loads the list asynchronously, so wait for it briefly. */
export function readVoices(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof speechSynthesis === 'undefined' || typeof speechSynthesis.getVoices !== 'function') {
        resolve(null);
        return;
      }
      const now = localVoices();
      if (now !== null) {
        resolve(now);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        speechSynthesis.removeEventListener?.('voiceschanged', finish);
        resolve(safe(localVoices, null));
      };
      const timer = setTimeout(finish, Math.min(timeoutMs, 600));
      speechSynthesis.addEventListener?.('voiceschanged', finish);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Taskbar / dock geometry: how much of the screen the OS reserves and on which edge. Set by the OS, so every browser on
 * the machine reports the same values (while the window is on the same monitor).
 */
export function readScreenLayout(): string | null {
  return safe(() => {
    if (typeof screen === 'undefined' || !screen.width || !screen.height) return null;
    const s = screen as Screen & { availLeft?: number; availTop?: number };
    return [
      screen.width - screen.availWidth,
      screen.height - screen.availHeight,
      s.availLeft ?? null,
      s.availTop ?? null,
    ].join(',');
  }, null);
}

// Codecs every engine supports in software; whether decoding is "power efficient" says whether the GPU decodes it.
const DECODE_PROBES: { contentType: string; width: number; height: number }[] = [
  { contentType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080 },
  { contentType: 'video/webm; codecs="vp09.00.10.08"', width: 1920, height: 1080 },
  { contentType: 'video/webm; codecs="vp09.00.51.08"', width: 3840, height: 2160 },
  { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080 },
  { contentType: 'video/mp4; codecs="av01.0.12M.08"', width: 3840, height: 2160 },
];

export async function readMediaDecode(timeoutMs: number): Promise<string | null> {
  const caps = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;
  if (!caps || typeof caps.decodingInfo !== 'function') return null;
  const bits = await Promise.all(
    DECODE_PROBES.map((p) =>
      safeAsync(
        async () => {
          const info = await caps.decodingInfo({
            type: 'file',
            video: { contentType: p.contentType, width: p.width, height: p.height, bitrate: 8_000_000, framerate: 30 },
          });
          return info.supported && info.powerEfficient ? '1' : '0';
        },
        '?',
        timeoutMs,
      ),
    ),
  );
  return bits.includes('?') ? null : bits.join('');
}

// Keys whose character differs between common layouts (QWERTY, QWERTZ, AZERTY, Dvorak, Colemak, Arabic, Cyrillic...).
const LAYOUT_KEYS = ['KeyQ', 'KeyW', 'KeyY', 'KeyZ', 'KeyA', 'KeyM', 'Semicolon', 'Quote', 'BracketLeft', 'Minus', 'Digit2'];

/** Installed keyboard layout (Chromium only; elsewhere null and simply not compared). */
export async function readKeyboardLayout(timeoutMs: number): Promise<string | null> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  if (!kb?.getLayoutMap) return null;
  return safeAsync(
    async () => {
      const map = await kb.getLayoutMap!();
      const keys = LAYOUT_KEYS.map((k) => map.get(k) ?? '');
      return keys.some(Boolean) ? keys.join('') : null;
    },
    null,
    timeoutMs,
  );
}

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string };
  features?: Iterable<string>;
  limits?: Record<string, unknown>;
}

export interface GpuReading {
  /** Vendor and architecture ("nvidia/ampere"): often less masked than WebGL in Firefox and Safari. */
  arch: string | null;
  /** Feature list and limits (see gpuCapabilities). */
  caps: string | null;
}

/** One WebGPU adapter request for both readings. */
export async function readGpu(timeoutMs: number): Promise<GpuReading> {
  const none: GpuReading = { arch: null, caps: null };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<GpuAdapterLike | null> } }).gpu;
  if (!gpu?.requestAdapter) return none;
  return safeAsync(
    async () => {
      const adapter = await gpu.requestAdapter!();
      const vendor = adapter?.info?.vendor?.toLowerCase().trim();
      const arch = adapter?.info?.architecture?.toLowerCase().trim();
      return { arch: vendor || arch ? `${vendor ?? ''}/${arch ?? ''}` : null, caps: gpuCapabilities(adapter) };
    },
    none,
    timeoutMs,
  );
}
