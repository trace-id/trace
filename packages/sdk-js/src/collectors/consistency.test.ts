import { describe, expect, it } from 'vitest';
import { buildConsistency, diffReadings, readPageEnv, readTimezoneOffsetMismatch } from './consistency.js';

describe('diffReadings', () => {
  it('reports only fields both sides read and that differ', () => {
    const page = { userAgent: 'A', languages: 'en-US,en', hardwareConcurrency: 8, timezone: 'Europe/Berlin', webglRenderer: 'X' };
    expect(diffReadings(page, { ...page })).toEqual([]);
    expect(diffReadings(page, { userAgent: 'B', languages: null, hardwareConcurrency: 4, webglRenderer: ' x ' })).toEqual([
      'hardwareConcurrency',
      'userAgent',
    ]);
    expect(diffReadings({ userAgent: null }, { userAgent: 'B' })).toEqual([]);
  });
});

describe('buildConsistency', () => {
  it('is consistent in an unpatched environment and reports a missing worker as null', () => {
    const c = buildConsistency(null, null);
    expect(c.workerMismatch).toBeNull();
    expect(c.timezoneOffsetMismatch).toBe(false);
    expect(c.iframeMismatch === null || c.iframeMismatch.length === 0).toBe(true);
  });

  it('flags a worker that reports another user agent', () => {
    const page = readPageEnv(null);
    const c = buildConsistency({ ...page, userAgent: 'Mozilla/5.0 (Spoofed)' }, null);
    expect(c.workerMismatch).toEqual(['userAgent']);
  });

  it('notices a faked getTimezoneOffset', () => {
    const original = Date.prototype.getTimezoneOffset;
    const real = new Date().getTimezoneOffset();
    Date.prototype.getTimezoneOffset = () => real + 180;
    try {
      expect(readTimezoneOffsetMismatch()).toBe(true);
    } finally {
      Date.prototype.getTimezoneOffset = original;
    }
    expect(readTimezoneOffsetMismatch()).toBe(false);
  });
});
