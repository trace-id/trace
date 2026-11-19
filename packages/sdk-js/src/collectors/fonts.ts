import { FONT_CANDIDATES } from '@trace-id/signals/fonts';
import { safe } from './safe.js';

export { FONT_CANDIDATES, fontsMask } from '@trace-id/signals/fonts';

const BASE_FONTS = ['monospace', 'sans-serif', 'serif'] as const;

/** Measurement-based: a font is present if text renders at a different size than every fallback. */
export function readFonts(): string[] | null {
  return safe(() => {
    if (!document.body) return null;
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;font-size:72px;white-space:nowrap;';
    const make = (family: string): HTMLSpanElement => {
      const span = document.createElement('span');
      span.textContent = 'mmmmmmmmmmlli1WQ@';
      span.style.fontFamily = family;
      container.appendChild(span);
      return span;
    };
    const base = BASE_FONTS.map((f) => ({ family: f, span: make(f) }));
    const tests = FONT_CANDIDATES.map((font) => ({
      font,
      spans: BASE_FONTS.map((fallback) => make(`'${font}',${fallback}`)),
    }));
    document.body.appendChild(container);
    try {
      const baseSizes = base.map(({ span }) => [span.offsetWidth, span.offsetHeight] as const);
      if (baseSizes.every(([w]) => w === 0)) return null;
      return tests
        .filter(({ spans }) =>
          spans.some((span, i) => {
            const [bw, bh] = baseSizes[i] ?? [0, 0];
            return span.offsetWidth !== bw || span.offsetHeight !== bh;
          }),
        )
        .map(({ font }) => font);
    } finally {
      container.remove();
    }
  }, null);
}
