import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, parseLimit } from './cursor.js';
import { uuidv7 } from './ids.js';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { createdAt: new Date('2026-11-14T10:00:00.123Z'), id: uuidv7() };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('rejects tampered or junk cursors', () => {
    const bad = Buffer.from('not-a-date|x').toString('base64url');
    for (const v of ['', '!!!', bad, 'x'.repeat(201), Buffer.from(`2026-11-14T10:00:00.000Z|${'a'.repeat(36)}`).toString('base64url')]) {
      expect(decodeCursor(v)).toBeNull();
    }
  });

  it('parses limits within 1..50', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('50')).toBe(50);
    for (const v of ['0', '51', '-1', '1.5', 'abc', ['5']]) expect(parseLimit(v)).toBeNull();
  });
});
