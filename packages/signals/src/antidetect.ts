import { fontsFromMask, OS_ONLY_FONTS } from './fonts.js';
import { type EnvironmentExtras } from './types.js';
import { browserFamily, type OsFamily, osFamily } from './ua.js';

/**
 * Consistency checks against what a browser claims about itself. Anti-detect browsers (and user-agent switchers) give
 * each profile a made-up device; the parts they forget to fake disagree with the parts they do.
 */

const APPLE_GPU = /\bApple (M\d|GPU)\b|Metal Renderer/i;
const DIRECT3D = /Direct3D|D3D1[01]/i;
// Mobile-only GPU families. Adreno is left out: Windows on Snapdragon laptops report it.
const MOBILE_GPU = /\b(Mali|PowerVR)\b/i;
const DESKTOP_GPU = /\b(GeForce|Quadro|Radeon (RX|Pro)|Intel\(R\) (UHD|HD|Iris)|Direct3D)\b/i;

/** Why a GPU renderer cannot belong to the OS the user agent claims, or null when it can. */
export function gpuOsMismatch(userAgent: string | null, renderer: string | null): string | null {
  if (!userAgent || !renderer) return null;
  const os: OsFamily = osFamily(userAgent);
  if ((os === 'windows' || os === 'linux' || os === 'android' || os === 'chromeos') && APPLE_GPU.test(renderer)) {
    return 'appleGpuOnNonApple';
  }
  if ((os === 'macos' || os === 'ios' || os === 'linux' || os === 'android') && DIRECT3D.test(renderer)) {
    return 'direct3dOnNonWindows';
  }
  if ((os === 'windows' || os === 'macos') && MOBILE_GPU.test(renderer)) return 'mobileGpuOnDesktop';
  if ((os === 'android' || os === 'ios') && DESKTOP_GPU.test(renderer)) return 'desktopGpuOnMobile';
  return null;
}

const CLIENT_HINT_OS: Record<string, OsFamily> = {
  windows: 'windows',
  macos: 'macos',
  linux: 'linux',
  android: 'android',
  'chrome os': 'chromeos',
  chromeos: 'chromeos',
  ios: 'ios',
};

/**
 * The Sec-CH-UA-Platform request header comes from the browser's network stack; navigator.userAgent can be overwritten
 * from JavaScript. When they name different operating systems, the page lies about the OS. Null when they agree or one
 * side is missing (Firefox and Safari send no client hints).
 */
export function clientHintsMismatch(secChUaPlatform: string | null, userAgent: string | null): string | null {
  if (!secChUaPlatform || !userAgent) return null;
  const hinted = CLIENT_HINT_OS[secChUaPlatform.replace(/"/g, '').trim().toLowerCase()];
  const claimed = osFamily(userAgent);
  if (!hinted || claimed === 'other') return null;
  if (hinted === claimed) return null;
  if (hinted === 'linux' && (claimed === 'android' || claimed === 'chromeos')) return null;
  return 'clientHintsMismatch';
}

/**
 * The engine the user agent implies against the one that actually runs the page (read from built-in error wording).
 * Every browser on iOS is WebKit. Anti-detect browsers are Chromium, so a "Firefox" or "Safari" profile on one fails.
 */
export function engineMismatch(env: EnvironmentExtras | undefined, userAgent: string | null): string | null {
  if (!env || env.engine === 'unknown' || !userAgent) return null;
  const family = browserFamily(userAgent);
  const expected =
    osFamily(userAgent) === 'ios'
      ? 'webkit'
      : family === 'firefox'
        ? 'gecko'
        : family === 'safari'
          ? 'webkit'
          : family === 'other'
            ? null
            : 'blink';
  return expected && expected !== env.engine ? 'engineMismatch' : null;
}

/**
 * Chromium reports its full version in client hints; tools that rewrite the user agent string to another Chrome
 * version rarely rewrite those too.
 */
export function uaVersionMismatch(env: EnvironmentExtras | undefined, userAgent: string | null): string | null {
  const full = env?.uaFullVersion;
  if (!full || !userAgent) return null;
  const claimed = /(?:Chrome|CriOS)\/(\d+)/.exec(userAgent)?.[1];
  const actual = /^(\d+)/.exec(full)?.[1];
  return claimed && actual && claimed !== actual ? 'uaVersionMismatch' : null;
}

const primary = (tag: string | undefined) => tag?.trim().split(/[-_;]/)[0]?.toLowerCase() || null;

/**
 * The Accept-Language header is sent by the network stack from the browser settings; navigator.languages can be
 * overwritten from JavaScript. Browsers keep the two in step, so a different first language means the page lies.
 */
export function languageHeaderMismatch(acceptLanguage: string | null | undefined, languages: readonly string[]): string | null {
  const header = primary(acceptLanguage?.split(',')[0]);
  const page = primary(languages[0]);
  return header && page && header !== page && header !== '*' ? 'languageHeaderMismatch' : null;
}

/**
 * Why the installed fonts cannot belong to the OS the user agent claims, or null. Two OS-only fonts of another system
 * are required, and only Windows and macOS claims are checked: Linux font configuration aliases font names freely.
 */
export function fontOsMismatch(userAgent: string | null, mask: string | undefined): string | null {
  if (!userAgent || !mask) return null;
  const os = osFamily(userAgent);
  if (os !== 'windows' && os !== 'macos') return null;
  const fonts = new Set(fontsFromMask(mask));
  const foreign = os === 'windows' ? OS_ONLY_FONTS.macos : OS_ONLY_FONTS.windows;
  return foreign.filter((f) => fonts.has(f)).length >= 2 ? (os === 'windows' ? 'macFontsOnWindows' : 'windowsFontsOnMac') : null;
}
