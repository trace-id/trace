import { type EnvironmentExtras } from '@trace-id/signals/types';
import { safe, safeAsync } from './safe.js';

/**
 * Extra readings. Everything here is read-only and prompt-free: no permission dialogs, no network requests, no access
 * to devices, files or location. Values that are high-entropy are hashed in collect.ts; the rest are short codes.
 */

type AnyRecord = Record<string, unknown>;

/**
 * Which JavaScript engine actually runs the page, from the wording of a built-in TypeError. A browser can rewrite its
 * user agent, but anti-detect browsers are Chromium inside, and V8, SpiderMonkey and JavaScriptCore word this
 * differently.
 */
export function detectEngine(): EnvironmentExtras['engine'] {
  return safe(() => {
    try {
      const nothing = null as unknown as AnyRecord;
      void nothing.x;
    } catch (e) {
      const m = String((e as Error).message);
      if (/Cannot read propert/i.test(m)) return 'blink';
      if (/has no properties/i.test(m)) return 'gecko';
      if (/is not an object/i.test(m)) return 'webkit';
    }
    return 'unknown';
  }, 'unknown' as const);
}

interface HighEntropy {
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  fullVersionList?: { brand: string; version: string }[];
}

/** User-Agent Client Hints (Chromium): OS version (tells Windows 11 from 10), CPU architecture, full browser version. */
export async function readHighEntropy(timeoutMs: number): Promise<Partial<EnvironmentExtras>> {
  const uaData = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<HighEntropy> } })
    .userAgentData;
  if (!uaData?.getHighEntropyValues) return {};
  return safeAsync<Partial<EnvironmentExtras>>(
    async () => {
      const v = await uaData.getHighEntropyValues!(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']);
      const brands = v.fullVersionList ?? [];
      const main = brands.find((b) => b.brand === 'Chromium') ?? brands.find((b) => !/not.?a.?brand/i.test(b.brand));
      const s = (x: unknown, n = 64) => (typeof x === 'string' && x ? x.slice(0, n) : null);
      return {
        uaPlatformVersion: s(v.platformVersion, 32),
        uaArchitecture: s(v.architecture, 16),
        uaBitness: s(v.bitness, 8),
        uaModel: s(v.model),
        uaFullVersion: s(main?.version, 32),
      };
    },
    {},
    timeoutMs,
  );
}

/** Locale settings the OS hands the browser: calendar, numbering system, hour cycle, number and date formatting. */
export function readIntl(): string | null {
  return safe(() => {
    const dtf = new Intl.DateTimeFormat();
    const o = dtf.resolvedOptions();
    const hour = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string };
    return [
      o.locale,
      o.calendar,
      o.numberingSystem,
      hour.hourCycle ?? '',
      new Intl.NumberFormat().format(1234567.891),
      dtf.format(new Date(Date.UTC(2020, 0, 2, 3, 4, 5))),
      new Intl.Collator().resolvedOptions().locale,
      new Intl.PluralRules().resolvedOptions().locale,
    ].join('|');
  }, null);
}

const TEXTS = ['mmmmmmmmmmlli1WQ@', '\u{1F600}\u{1F984}\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}', '\u{FDFA}\u{0BF5}\u{16A0}\u{0E3F}'];
const FAMILIES = ['serif', 'sans-serif', 'monospace', 'system-ui'];

/** Glyph metrics from canvas text measurement: font rasterisation and emoji fonts differ by OS, version and settings. */
export function readTextMetrics(): string | null {
  return safe(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || typeof ctx.measureText !== 'function') return null;
    const out: string[] = [];
    for (const family of FAMILIES) {
      ctx.font = `16px ${family}`;
      for (const text of TEXTS) {
        const m = ctx.measureText(text);
        out.push([m.width, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, m.actualBoundingBoxLeft].map((n) => (Number.isFinite(n) ? n.toFixed(2) : '')).join(','));
      }
    }
    return out.join(';');
  }, null);
}

const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}';
const FS = 'precision mediump float;varying vec2 v;void main(){gl_FragColor=vec4(sin(v.x*7.3)*.5+.5,cos(v.y*5.1)*.5+.5,fract(v.x*v.y*13.7),1.);}';

function renderOnce(): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -0.6, -0.3, 1, 0.9, 0.8]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0.1, 0.2, 0.3, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(32 * 32 * 4);
  gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const precision = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER]
    .flatMap((t) => [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT, gl.HIGH_INT].map((p) => {
      const f = gl.getShaderPrecisionFormat(t, p);
      return f ? `${f.rangeMin}.${f.rangeMax}.${f.precision}` : '';
    }))
    .join(',');
  // Sum per row keeps the string short while staying sensitive to every pixel.
  let rows = '';
  for (let y = 0; y < 32; y++) {
    let sum = 0;
    for (let i = y * 128; i < (y + 1) * 128; i++) sum = (sum * 31 + px[i]!) >>> 0;
    rows += sum.toString(36);
  }
  return `${precision}|${rows}`;
}

/** A small shaded scene rendered by the GPU and read back. Omitted when two renders differ (the browser adds noise). */
export function readWebglRender(): string | null {
  return safe(() => {
    const a = renderOnce();
    if (!a) return null;
    return renderOnce() === a ? a : null;
  }, null);
}

// Chosen to separate engines, versions and builds; order is part of the format.
const NAV_APIS = ['bluetooth', 'usb', 'hid', 'serial', 'xr', 'gpu', 'ink', 'scheduling', 'virtualKeyboard', 'wakeLock', 'share', 'keyboard'];
const WIN_APIS = ['SharedArrayBuffer', 'ApplePaySession', 'IdleDetector', 'EyeDropper', 'Scheduler', 'trustedTypes', 'showOpenFilePicker', 'queryLocalFonts', 'ViewTransition', 'webkitRequestFileSystem', 'mozInnerScreenX', 'GestureEvent'];

/** Which APIs exist (not their values): pins down engine, version and build flags; plus a few stable settings. */
export function readApiSurface(): string | null {
  return safe(() => {
    const nav = navigator as unknown as AnyRecord;
    const win = window as unknown as AnyRecord;
    const bits = (names: string[], obj: AnyRecord) => names.map((n) => (n in obj ? '1' : '0')).join('');
    const plugins = safe(() => Array.from(navigator.plugins, (p) => p.name).slice(0, 8).join(','), '');
    return [
      bits(NAV_APIS, nav),
      bits(WIN_APIS, win),
      String(nav.vendor ?? ''),
      String(nav.productSub ?? ''),
      String(nav.pdfViewerEnabled ?? ''),
      plugins,
      String(safe(() => navigator.mimeTypes.length, -1)),
    ].join('|');
  }, null);
}

/** Smallest step of performance.now(): privacy modes coarsen it (Tor and Firefox resistFingerprinting to 16-100 ms). */
export function readTimerResolution(): number | null {
  return safe(() => {
    if (typeof performance === 'undefined') return null;
    let min = Infinity;
    let last = performance.now();
    for (let i = 0; i < 20000 && min > 0.001; i++) {
      const now = performance.now();
      const d = now - last;
      if (d > 0 && d < min) min = d;
      last = now;
    }
    return Number.isFinite(min) ? Math.round(min * 1000) / 1000 : null;
  }, null);
}

const PERMISSIONS = ['notifications', 'geolocation', 'camera', 'microphone', 'persistent-storage', 'midi', 'clipboard-read'];

/** Permission states as one letter each (g granted, d denied, p prompt, - unsupported). Querying never prompts. */
export async function readPermissions(timeoutMs: number): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  const states = await Promise.all(
    PERMISSIONS.map((name) =>
      safeAsync(async () => (await navigator.permissions.query({ name: name as PermissionName })).state[0] ?? '-', '-', timeoutMs),
    ),
  );
  return states.join('');
}

/**
 * Chrome DevTools Protocol at work: automation (Puppeteer, Playwright) serialises console arguments, which reads an
 * error's stack. Logged at debug level, which consoles hide by default. Real DevTools with the console open does the
 * same, so the server treats it as a weak indicator only.
 */
export function readCdp(): boolean {
  return safe(() => {
    let hit = false;
    const e = new Error('');
    Object.defineProperty(e, 'stack', {
      configurable: true,
      get() {
        hit = true;
        return '';
      },
    });
    console.debug(e);
    return hit;
  }, false);
}

export function readMultiScreen(): boolean | null {
  return safe(() => {
    const ext = (screen as Screen & { isExtended?: boolean }).isExtended;
    return typeof ext === 'boolean' ? ext : null;
  }, null);
}

export function readPrivacyPrefs(): Pick<EnvironmentExtras, 'gpc' | 'doNotTrack'> {
  const nav = navigator as unknown as AnyRecord;
  return {
    gpc: safe(() => (typeof nav.globalPrivacyControl === 'boolean' ? nav.globalPrivacyControl : null), null),
    doNotTrack: safe(() => nav.doNotTrack === '1' || (window as unknown as AnyRecord).doNotTrack === '1', false),
  };
}

/** WebGPU adapter capabilities: feature list and selected limits, which follow the GPU and driver closely. */
export function gpuCapabilities(adapter: { features?: Iterable<string>; limits?: AnyRecord } | null | undefined): string | null {
  return safe(() => {
    if (!adapter) return null;
    const features = adapter.features ? [...adapter.features].sort().join(',') : '';
    const L = adapter.limits ?? {};
    const limits = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupSizeX', 'maxComputeInvocationsPerWorkgroup', 'maxBindGroups', 'maxColorAttachments']
      .map((k) => String(L[k] ?? ''))
      .join(',');
    return features || limits.replace(/,/g, '') ? `${features}|${limits}` : null;
  }, null);
}

const SYSTEM_COLORS = ['ButtonFace', 'ButtonText', 'Canvas', 'CanvasText', 'Field', 'Highlight', 'HighlightText', 'LinkText', 'GrayText', 'AccentColor', 'AccentColorText', 'Mark'];
const SYSTEM_FONTS = ['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar'];

/** CSS system colours and system fonts: the OS theme, accent colour and UI font as the browser maps them. */
export function readSystemStyle(): string | null {
  return safe(() => {
    if (!document.body) return null;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;visibility:hidden;color-scheme:light';
    document.body.appendChild(el);
    try {
      const cs = getComputedStyle(el);
      const colors = SYSTEM_COLORS.map((c) => {
        el.style.color = '';
        el.style.color = c;
        return cs.color;
      });
      const fonts = SYSTEM_FONTS.map((f) => {
        el.style.font = '';
        el.style.font = f;
        return `${cs.fontFamily} ${cs.fontSize} ${cs.fontWeight}`;
      });
      return `${colors.join(',')}|${fonts.join(',')}`;
    } finally {
      el.remove();
    }
  }, null);
}

const MEDIA_TYPES = [
  'video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="av01.0.05M.08"',
  'video/webm; codecs="vp8"', 'video/webm; codecs="vp9"', 'video/webm; codecs="av1"', 'video/ogg; codecs="theora"',
  'video/x-matroska', 'application/vnd.apple.mpegurl', 'audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="ac-3"',
  'audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="flac"', 'audio/webm; codecs="opus"', 'audio/ogg; codecs="vorbis"',
  'audio/mpeg', 'audio/wav; codecs="1"', 'audio/x-m4a', 'audio/aac',
];

/** Which media formats play (licensed codecs differ by OS, browser build and distribution). */
export function readCodecs(): string | null {
  return safe(() => {
    const v = document.createElement('video');
    if (typeof v.canPlayType !== 'function') return null;
    const ms = (globalThis as unknown as { MediaSource?: { isTypeSupported?: (t: string) => boolean } }).MediaSource;
    return MEDIA_TYPES.map((t) => {
      const play = v.canPlayType(t);
      const p = play === 'probably' ? 'p' : play === 'maybe' ? 'm' : '-';
      return p + (safe(() => (ms?.isTypeSupported?.(t) ? '1' : '0'), '?'));
    }).join('');
  }, null);
}

const GL2_PARAMS = ['MAX_SAMPLES', 'MAX_3D_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_COLOR_ATTACHMENTS', 'MAX_DRAW_BUFFERS', 'MAX_UNIFORM_BUFFER_BINDINGS', 'MAX_UNIFORM_BLOCK_SIZE', 'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS', 'MAX_VERTEX_UNIFORM_COMPONENTS', 'MAX_FRAGMENT_UNIFORM_COMPONENTS', 'MAX_ELEMENT_INDEX', 'MAX_TEXTURE_LOD_BIAS'] as const;

/** WebGL 2 limits and extensions: a second, larger view of the GPU and driver. */
export function readWebgl2(): string | null {
  return safe(() => {
    const gl = document.createElement('canvas').getContext('webgl2') as (WebGL2RenderingContext & AnyRecord) | null;
    if (!gl) return null;
    const params = GL2_PARAMS.map((n) => String(gl.getParameter(gl[n] as number)));
    const ext = (gl.getSupportedExtensions() ?? []).slice().sort();
    return `${params.join(',')}|${ext.join(',')}`;
  }, null);
}

export function readConnectionAndFrame(): Pick<EnvironmentExtras, 'connectionRtt' | 'connectionType' | 'framed' | 'outerSize'> {
  const c = safe(() => (navigator as unknown as { connection?: { rtt?: number; effectiveType?: string } }).connection, undefined);
  return {
    connectionRtt: safe(() => (typeof c?.rtt === 'number' ? c.rtt : null), null),
    connectionType: safe(() => (typeof c?.effectiveType === 'string' ? c.effectiveType.slice(0, 8) : null), null),
    framed: safe(() => window.top !== window.self, true),
    outerSize: safe(() => `${window.outerWidth}x${window.outerHeight}`, null),
  };
}
