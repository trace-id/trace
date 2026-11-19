import { type TamperIndicators } from '@trace-id/signals/types';
import { safe } from './safe.js';
import { browserFamily, osFamily, platformFamily, platformsCompatible } from './ua.js';

type Target = [label: string, get: () => unknown];

function getter(proto: object | undefined, prop: string): () => unknown {
  return () => (proto ? Object.getOwnPropertyDescriptor(proto, prop)?.get : undefined);
}

function method(proto: object | undefined, prop: string): () => unknown {
  return () => (proto ? (proto as Record<string, unknown>)[prop] : undefined);
}

function targets(): Target[] {
  const g = globalThis as unknown as Record<string, { prototype?: object } | undefined>;
  return [
    ['Navigator.userAgent', getter(g.Navigator?.prototype, 'userAgent')],
    ['Navigator.platform', getter(g.Navigator?.prototype, 'platform')],
    ['Navigator.webdriver', getter(g.Navigator?.prototype, 'webdriver')],
    ['Navigator.languages', getter(g.Navigator?.prototype, 'languages')],
    ['Navigator.hardwareConcurrency', getter(g.Navigator?.prototype, 'hardwareConcurrency')],
    ['Screen.width', getter(g.Screen?.prototype, 'width')],
    ['HTMLCanvasElement.toDataURL', method(g.HTMLCanvasElement?.prototype, 'toDataURL')],
    ['HTMLCanvasElement.getContext', method(g.HTMLCanvasElement?.prototype, 'getContext')],
    ['CanvasRenderingContext2D.getImageData', method(g.CanvasRenderingContext2D?.prototype, 'getImageData')],
    ['WebGLRenderingContext.getParameter', method(g.WebGLRenderingContext?.prototype, 'getParameter')],
    ['AudioBuffer.getChannelData', method(g.AudioBuffer?.prototype, 'getChannelData')],
    ['Date.getTimezoneOffset', method(Date.prototype, 'getTimezoneOffset')],
    ['Intl.DateTimeFormat.resolvedOptions', method(Intl.DateTimeFormat.prototype, 'resolvedOptions')],
    ['Function.toString', method(Function.prototype, 'toString')],
  ];
}

const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

function isNative(fn: unknown): boolean {
  if (typeof fn !== 'function') return true;
  const src = safe(() => Function.prototype.toString.call(fn), '');
  return NATIVE.test(src);
}

export function readTamperIndicators(canvasNoise: boolean): TamperIndicators {
  const ua = safe(() => navigator.userAgent, '');
  const platform = safe(() => navigator.platform, '');
  const family = browserFamily(ua);
  const hasUaData = safe(() => 'userAgentData' in navigator, false);
  const secure = safe(() => window.isSecureContext, false);
  const claimsChromiumDesktop = (family === 'chrome' || family === 'edge') && !/Mobi|Android|CriOS/.test(ua);
  const claimsSafariOrFirefox = family === 'safari' || family === 'firefox';
  return {
    nativeOverrides: safe(
      () => targets().filter(([, get]) => !isNative(safe(get, undefined))).map(([label]) => label),
      [],
    ),
    navigatorOwnProperties: safe(
      () =>
        ['userAgent', 'platform', 'webdriver', 'languages', 'hardwareConcurrency', 'deviceMemory'].filter((p) =>
          Object.prototype.hasOwnProperty.call(navigator, p),
        ),
      [],
    ),
    uaPlatformMismatch: platform !== '' && !platformsCompatible(osFamily(ua), platformFamily(platform)),
    uaFeatureMismatch: secure && ((claimsChromiumDesktop && !hasUaData) || (claimsSafariOrFirefox && hasUaData)),
    canvasNoise,
  };
}
