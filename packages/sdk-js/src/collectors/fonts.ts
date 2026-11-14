import { safe } from './safe.js';

const BASE_FONTS = ['monospace', 'sans-serif', 'serif'] as const;

const CANDIDATES = [
  'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Book Antiqua', 'Bookman Old Style', 'Calibri', 'Cambria',
  'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic',
  'Futura', 'Garamond', 'Geneva', 'Gill Sans', 'Helvetica Neue', 'Impact', 'Lucida Console',
  'Lucida Grande', 'Lucida Sans Unicode', 'Menlo', 'Monaco', 'MS Gothic', 'MS Mincho', 'MS Outlook',
  'MS Reference Sans Serif', 'MT Extra', 'Optima', 'Palatino', 'Palatino Linotype', 'Segoe Print',
  'Segoe Script', 'Segoe UI Emoji', 'SimSun', 'Source Code Pro', 'Tahoma', 'Trebuchet MS', 'Ubuntu',
  'DejaVu Sans', 'Liberation Mono', 'Noto Color Emoji', 'Cantarell', 'Droid Sans', 'Roboto',
  'Apple Color Emoji', 'Avenir', 'Avenir Next', 'Baskerville', 'Didot', 'Hoefler Text', 'Marker Felt',
  'PingFang SC', 'Hiragino Sans', 'Yu Gothic', 'Malgun Gothic', 'Microsoft YaHei', 'Nirmala UI',
];

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
    const tests = CANDIDATES.map((font) => ({
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
