import { safe } from './safe.js';

const CSS_FEATURES = [
  'display: grid',
  'display: contents',
  'container-type: inline-size',
  'aspect-ratio: 1',
  'backdrop-filter: blur(1px)',
  '-webkit-backdrop-filter: blur(1px)',
  'color: color-mix(in srgb, red, blue)',
  'color: oklch(0.5 0.1 100)',
  'text-wrap: balance',
  'selector(:has(a))',
  'anchor-name: --a',
  'view-transition-name: a',
  'field-sizing: content',
  'scrollbar-gutter: stable',
  'overflow: clip',
  'accent-color: red',
  'inset: 0',
  'font-size: 1lh',
  'text-decoration-thickness: from-font',
  'math-style: compact',
  '-moz-appearance: none',
  '-webkit-touch-callout: none',
];

// Excludes user-toggled preferences such as prefers-color-scheme, which change too often.
const MEDIA_QUERIES = [
  '(color-gamut: p3)',
  '(color-gamut: rec2020)',
  '(dynamic-range: high)',
  '(pointer: fine)',
  '(pointer: coarse)',
  '(any-pointer: coarse)',
  '(hover: hover)',
  '(any-hover: hover)',
  '(forced-colors: active)',
  '(inverted-colors: inverted)',
  '(monochrome)',
];

export function readCssFeatures(): string | null {
  return safe(() => {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null;
    return CSS_FEATURES.map((f) => (safe(() => CSS.supports(f), false) ? '1' : '0')).join('');
  }, null);
}

export function readMediaFeatures(): string | null {
  return safe(() => {
    if (typeof matchMedia !== 'function') return null;
    return MEDIA_QUERIES.map((q) => (safe(() => matchMedia(q).matches, false) ? '1' : '0')).join('');
  }, null);
}
