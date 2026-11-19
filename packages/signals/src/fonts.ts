// Order is part of the fontsMask format: append new fonts at the end, never reorder.
export const FONT_CANDIDATES = [
  'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Book Antiqua', 'Bookman Old Style', 'Calibri', 'Cambria',
  'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic',
  'Futura', 'Garamond', 'Geneva', 'Gill Sans', 'Helvetica Neue', 'Impact', 'Lucida Console',
  'Lucida Grande', 'Lucida Sans Unicode', 'Menlo', 'Monaco', 'MS Gothic', 'MS Mincho', 'MS Outlook',
  'MS Reference Sans Serif', 'MT Extra', 'Optima', 'Palatino', 'Palatino Linotype', 'Segoe Print',
  'Segoe Script', 'Segoe UI Emoji', 'SimSun', 'Source Code Pro', 'Tahoma', 'Trebuchet MS', 'Ubuntu',
  'DejaVu Sans', 'Liberation Mono', 'Noto Color Emoji', 'Cantarell', 'Droid Sans', 'Roboto',
  'Apple Color Emoji', 'Avenir', 'Avenir Next', 'Baskerville', 'Didot', 'Hoefler Text', 'Marker Felt',
  'PingFang SC', 'Hiragino Sans', 'Yu Gothic', 'Malgun Gothic', 'Microsoft YaHei', 'Nirmala UI',
] as const;

/** Which candidates are present, as a hex bitmap in FONT_CANDIDATES order (for partial matching across browsers). */
export function fontsMask(fonts: readonly string[]): string {
  const present = new Set(fonts);
  let hex = '';
  for (let i = 0; i < FONT_CANDIDATES.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) if (present.has(FONT_CANDIDATES[i + j] ?? '')) nibble |= 8 >> j;
    hex += nibble.toString(16);
  }
  return hex;
}

/** Inverse of fontsMask. Unknown trailing bits (a newer SDK with more candidates) are ignored. */
export function fontsFromMask(mask: string): string[] {
  const out: string[] = [];
  for (let n = 0; n < mask.length; n++) {
    const nibble = parseInt(mask[n]!, 16);
    if (Number.isNaN(nibble)) return [];
    for (let j = 0; j < 4; j++) {
      const font = FONT_CANDIDATES[n * 4 + j];
      if (font && nibble & (8 >> j)) out.push(font);
    }
  }
  return out;
}

/**
 * Fonts that ship with one operating system and are not installed by common software (Office for Mac installs many
 * Windows fonts, so those are left out). Used to catch a browser whose user agent claims another OS.
 */
export const OS_ONLY_FONTS = {
  windows: ['Segoe UI Emoji', 'Bahnschrift', 'Nirmala UI'],
  macos: ['Apple Color Emoji', 'PingFang SC', 'Hiragino Sans', 'Marker Felt', 'Menlo', 'Lucida Grande', 'Geneva'],
} as const;
