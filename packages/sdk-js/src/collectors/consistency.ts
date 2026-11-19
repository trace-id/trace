import { timezoneOffsetMinutes } from '@trace-id/signals/tzoffset';
import { type ConsistencyIndicators } from '@trace-id/signals/types';
import { safe } from './safe.js';

/**
 * The same readings, taken where spoofing tools often forget to patch: a Web Worker (its own navigator and a WebGL
 * context on an OffscreenCanvas) and a fresh same-origin iframe. Only the names of fields that differ leave the page.
 */
export interface EnvReading {
  userAgent?: string | null;
  platform?: string | null;
  languages?: string | null;
  hardwareConcurrency?: number | null;
  timezone?: string | null;
  webglRenderer?: string | null;
  webdriver?: boolean | null;
}

/** Fields present on both sides that disagree. A field one side cannot read is not compared. */
export function diffReadings(page: EnvReading, other: EnvReading): string[] {
  const out: string[] = [];
  for (const key of Object.keys(other) as (keyof EnvReading)[]) {
    const a = page[key];
    const b = other[key];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
    if (norm(a) !== norm(b)) out.push(key);
  }
  return out.sort();
}

function navigatorReading(nav: Navigator | undefined): EnvReading {
  if (!nav) return {};
  return {
    userAgent: safe(() => nav.userAgent, null),
    platform: safe(() => nav.platform, null),
    languages: safe(() => (nav.languages?.length ? nav.languages.join(',') : null), null),
    hardwareConcurrency: safe(() => nav.hardwareConcurrency ?? null, null),
    webdriver: safe(() => (typeof nav.webdriver === 'boolean' ? nav.webdriver : null), null),
  };
}

export function readPageEnv(webglRenderer: string | null): EnvReading {
  return {
    ...navigatorReading(typeof navigator === 'undefined' ? undefined : navigator),
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null, null),
    webglRenderer,
  };
}

// Plain ES5-safe source: runs in the worker as is, never bundled or transformed.
const WORKER_SOURCE = `onmessage=function(){var n=self.navigator||{},r=null;try{var c=new OffscreenCanvas(1,1).getContext('webgl'),e=c&&c.getExtension('WEBGL_debug_renderer_info');r=e?c.getParameter(e.UNMASKED_RENDERER_WEBGL):null}catch(x){}var t=null;try{t=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(x){}postMessage({userAgent:n.userAgent||null,platform:n.platform||null,languages:n.languages&&n.languages.length?n.languages.join(','):null,hardwareConcurrency:typeof n.hardwareConcurrency==='number'?n.hardwareConcurrency:null,webdriver:typeof n.webdriver==='boolean'?n.webdriver:null,timezone:t||null,webglRenderer:r})}`;

/** Readings from a dedicated worker; null when workers are unavailable or blocked (CSP worker-src, sandboxed frames). */
export function readWorkerEnv(timeoutMs: number): Promise<EnvReading | null> {
  return new Promise((resolve) => {
    let url: string | null = null;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: EnvReading | null) => {
      if (timer !== undefined) clearTimeout(timer);
      safe(() => worker?.terminate(), undefined);
      if (url) safe(() => URL.revokeObjectURL(url!), undefined);
      resolve(value);
    };
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
        resolve(null);
        return;
      }
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }));
      worker = new Worker(url);
      timer = setTimeout(() => finish(null), timeoutMs);
      worker.onmessage = (e: MessageEvent) => finish(typeof e.data === 'object' && e.data !== null ? (e.data as EnvReading) : null);
      worker.onerror = () => finish(null);
      worker.postMessage(0);
    } catch {
      finish(null);
    }
  });
}

/** Readings from a fresh about:blank iframe, which inherits the page origin but not patches made to the page window. */
export function readIframeEnv(): EnvReading | null {
  return safe(() => {
    if (typeof document === 'undefined' || !document.body) return null;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.appendChild(frame);
    try {
      const win = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!win) return null;
      return {
        ...navigatorReading(win.navigator),
        timezone: safe(() => win.Intl.DateTimeFormat().resolvedOptions().timeZone ?? null, null),
      };
    } finally {
      frame.remove();
    }
  }, null);
}

/** Date#getTimezoneOffset against the offset of the Intl time zone: tools that fake one often forget the other. */
export function readTimezoneOffsetMismatch(): boolean {
  return safe(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return false;
    const now = new Date();
    const expected = timezoneOffsetMinutes(zone, now);
    if (expected === null) return false;
    return Math.abs(expected + now.getTimezoneOffset()) >= 1;
  }, false);
}

/** Combines a worker reading taken in parallel with the other probes and the page readings taken now. */
export function buildConsistency(worker: EnvReading | null, webglRenderer: string | null): ConsistencyIndicators {
  const page = readPageEnv(webglRenderer);
  const iframe = readIframeEnv();
  return {
    workerMismatch: worker ? diffReadings(page, worker) : null,
    iframeMismatch: iframe ? diffReadings(page, iframe) : null,
    timezoneOffsetMismatch: readTimezoneOffsetMismatch(),
  };
}
