import { safe, safeAsync } from './safe.js';

// Passive reading of what extensions and content blockers leave inside the page. Nothing here makes a network request,
// probes extension resources, prompts, or reads a device: it only looks at the page's own DOM and globals, after the
// extensions have run. Raw results are hashed by the caller; the server never sees which extensions were found.

type AnyRecord = Record<string, unknown>;

/** Elements, attributes and classes that well-known extensions add to a page. Stable, public, and cheap to check. */
const DOM_MARKERS: [name: string, selector: string][] = [
  ['grammarly', 'grammarly-desktop-integration, [data-gr-ext-installed], [data-new-gr-c-s-check-loaded]'],
  ['lastpass', '[data-lastpass-root], [data-lastpass-icon-root]'],
  ['darkreader', 'meta[name="darkreader"], [data-darkreader-mode], style.darkreader'],
  ['googleTranslate', 'html.translated-ltr, html.translated-rtl'],
  ['loom', '#loom-companion-mv3, #loom-companion'],
  ['colorzilla', '[cz-shortcut-listen]'],
  ['honey', '#honey-container, honey-extension'],
  ['bitwarden', '[data-bwautofill], bit-autofill-button, [id^="bitwarden"]'],
  ['dashlane', 'dashlane-autofill, [data-dashlane-rid]'],
  ['onepassword', 'com-1password-button, [data-onepassword-extension-id]'],
  ['keeper', '[data-keeper-lock-id], #keeper-ext'],
  ['languagetool', 'lt-toolbar, lt-div'],
  ['adguard', '[adguard-ext], .adguard-alert'],
  ['pocket', '#pocket-extension, [data-pocket-extension]'],
];

/** Page globals that wallets and developer tools inject. A presence check only; nothing is called. */
const GLOBAL_MARKERS: [name: string, test: (w: AnyRecord) => boolean][] = [
  ['ethereum', (w) => typeof w.ethereum === 'object' && w.ethereum !== null],
  ['metamask', (w) => safe(() => (w.ethereum as AnyRecord | undefined)?.isMetaMask === true, false)],
  ['coinbaseWallet', (w) => safe(() => (w.ethereum as AnyRecord | undefined)?.isCoinbaseWallet === true, false)],
  ['phantom', (w) => safe(() => (w.phantom as AnyRecord | undefined) !== undefined || (w.solana as AnyRecord | undefined)?.isPhantom === true, false)],
  ['reactDevtools', (w) => '__REACT_DEVTOOLS_GLOBAL_HOOK__' in w && safe(() => (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as AnyRecord).renderers !== undefined, false)],
  ['reduxDevtools', (w) => '__REDUX_DEVTOOLS_EXTENSION__' in w],
  ['vueDevtools', (w) => '__VUE_DEVTOOLS_GLOBAL_HOOK__' in w],
];

const EXTENSION_URL = /^(?:chrome|moz|safari-web)-extension:\/\/([a-z0-9-]{8,64})\//i;

/**
 * Extension ids found in URLs the extensions themselves injected (an icon, a stylesheet, an iframe). A browser profile's
 * extension ids are stable and highly distinctive, which is why only a hash of the sorted set leaves the page.
 */
export function injectedExtensionIds(root: ParentNode = document): string[] {
  return safe(() => {
    const ids = new Set<string>();
    for (const el of Array.from(root.querySelectorAll('[src], [href]')).slice(0, 2000)) {
      for (const attr of ['src', 'href']) {
        const m = EXTENSION_URL.exec(el.getAttribute(attr) ?? '');
        if (m) ids.add(m[1]!.toLowerCase());
      }
    }
    return [...ids].sort();
  }, []);
}

/** Names of the known extensions and tools whose marks are present, sorted. */
export function readExtensionMarkers(root: ParentNode = document, win: AnyRecord = window as unknown as AnyRecord): string[] {
  const found = new Set<string>();
  for (const [name, selector] of DOM_MARKERS) {
    if (safe(() => root.querySelector(selector) !== null || document.documentElement.matches(selector), false)) found.add(name);
  }
  for (const [name, test] of GLOBAL_MARKERS) {
    if (safe(() => test(win), false)) found.add(name);
  }
  return [...found].sort();
}

/**
 * The string that is hashed into the `extensions` component, or null when nothing was found (an unextended browser has
 * no component rather than a hash everyone shares).
 */
export function readExtensions(): string | null {
  const markers = readExtensionMarkers();
  const ids = injectedExtensionIds();
  if (markers.length === 0 && ids.length === 0) return null;
  return `${markers.join(',')}|${ids.join(',')}`;
}

/**
 * Whether a content blocker hides ad-looking elements. A bait element carries the class names filter lists target; if it
 * is removed, hidden or collapsed, a blocker acted. It is a DOM check only: no ad request is made. Returns null when the
 * check cannot run.
 */
export async function readAdBlock(timeoutMs: number): Promise<boolean | null> {
  if (typeof document === 'undefined' || !document.body) return null;
  return safeAsync(
    () =>
      new Promise<boolean | null>((resolve) => {
        const bait = document.createElement('div');
        bait.className = 'adsbox ad-banner ad-placement pub_300x250 textads banner_ad sponsor-ad';
        bait.setAttribute('aria-hidden', 'true');
        bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none';
        bait.innerHTML = '&nbsp;';
        document.body.appendChild(bait);
        // Cosmetic filters are applied a moment after insertion.
        setTimeout(() => {
          const s = bait.isConnected ? getComputedStyle(bait) : null;
          const blocked = !s || s.display === 'none' || s.visibility === 'hidden' || s.height === '0px';
          if (bait.isConnected) bait.remove();
          resolve(blocked);
        }, Math.min(120, Math.max(20, timeoutMs / 4)));
      }),
    null,
    timeoutMs,
  );
}
