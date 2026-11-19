import { describe, expect, it } from 'vitest';
import { normalizeVoiceName, readDisplayPrefs, readVoices } from './device.js';
import { FONT_CANDIDATES, fontsMask } from './fonts.js';

describe('device collectors', () => {
  it('normalizes the same OS voice as reported by Chromium and Firefox', () => {
    expect(normalizeVoiceName('Microsoft David - English (United States)')).toBe('microsoft david');
    expect(normalizeVoiceName('Microsoft David Desktop - English (United States)')).toBe('microsoft david');
    expect(normalizeVoiceName('Samantha')).toBe('samantha');
  });

  it('reads display preferences as a fixed-length bit string', () => {
    const prefs = readDisplayPrefs();
    if (prefs !== null) expect(prefs).toMatch(/^[01]{8}$/);
  });

  it('resolves voices without throwing when speech synthesis is missing', async () => {
    await expect(readVoices(50)).resolves.toSatisfy((v: unknown) => v === null || typeof v === 'string');
  });

  it('encodes installed fonts as a fixed-length bitmap in candidate order', () => {
    const empty = fontsMask([]);
    expect(empty).toHaveLength(Math.ceil(FONT_CANDIDATES.length / 4));
    expect(empty).toMatch(/^0+$/);
    expect(fontsMask([FONT_CANDIDATES[0]!]).startsWith('8')).toBe(true);
    expect(fontsMask([FONT_CANDIDATES[3]!]).startsWith('1')).toBe(true);
    expect(fontsMask(['Not A Font'])).toBe(empty);
  });
});
