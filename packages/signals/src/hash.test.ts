import { describe, expect, it } from 'vitest';
import { hashComponent, stableStringify } from './hash.js';

describe('hashComponent', () => {
  it('is deterministic and fixed-length', () => {
    expect(hashComponent('abc')).toBe(hashComponent('abc'));
    expect(hashComponent('abc')).toHaveLength(28);
    expect(hashComponent('')).toHaveLength(28);
  });

  it('separates near-identical inputs', () => {
    expect(hashComponent('1920x1080')).not.toBe(hashComponent('1920x1081'));
  });
});

describe('stableStringify', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
  });
});
