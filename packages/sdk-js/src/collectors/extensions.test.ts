import { afterEach, describe, expect, it } from 'vitest';
import { injectedExtensionIds, readAdBlock, readExtensionMarkers, readExtensions } from './extensions.js';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-darkreader-mode');
});

describe('extension marks', () => {
  it('finds nothing in a clean page, and no component', () => {
    expect(readExtensionMarkers(document, {})).toEqual([]);
    expect(injectedExtensionIds()).toEqual([]);
    expect(readExtensions()).toBeNull();
  });

  it('names known extensions from the DOM they inject and from page globals', () => {
    document.body.innerHTML = '<grammarly-desktop-integration></grammarly-desktop-integration><div data-lastpass-root></div>';
    document.documentElement.setAttribute('data-darkreader-mode', 'dynamic');
    const found = readExtensionMarkers(document, { ethereum: { isMetaMask: true }, __REDUX_DEVTOOLS_EXTENSION__: {} });
    expect(found).toEqual(['darkreader', 'ethereum', 'grammarly', 'lastpass', 'metamask', 'reduxDevtools']);
  });

  it('reads extension ids from elements the extensions injected, sorted and deduplicated', () => {
    document.body.innerHTML =
      '<img src="chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/icon.png">' +
      '<link href="chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/style.css">' +
      '<a href="chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/page.html">x</a>' +
      '<img src="https://example.com/chrome-extension://zzzzzzzzzzzzzzzz/x.png">';
    expect(injectedExtensionIds()).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    expect(readExtensions()).toBe('|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('gives the same string for the same set in any order', () => {
    document.body.innerHTML = '<div data-lastpass-root></div><grammarly-desktop-integration></grammarly-desktop-integration>';
    const a = readExtensions();
    document.body.innerHTML = '<grammarly-desktop-integration></grammarly-desktop-integration><div data-lastpass-root></div>';
    expect(readExtensions()).toBe(a);
  });
});

describe('content blocker check', () => {
  it('reports false when the bait element stays visible and removes the bait afterwards', async () => {
    expect(await readAdBlock(400)).toBe(false);
    expect(document.querySelector('.adsbox')).toBeNull();
  });

  it('reports true when a filter hides elements with ad class names', async () => {
    const style = document.createElement('style');
    style.textContent = '.adsbox { display: none !important; }';
    document.head.appendChild(style);
    expect(await readAdBlock(400)).toBe(true);
  });

  it('reports true when the element is removed from the page', async () => {
    const observer = new MutationObserver(() => document.querySelector('.adsbox')?.remove());
    observer.observe(document.body, { childList: true });
    try {
      expect(await readAdBlock(400)).toBe(true);
    } finally {
      observer.disconnect();
    }
  });
});
