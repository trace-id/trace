import { randomBytes } from 'node:crypto';
import { type EventResponse } from '@trace-id/signals/api';
import { SealedResultError, unsealEventResult } from '@trace-id/sdk-node/sealed';
import { describe, expect, it } from 'vitest';
import { CidrSet } from '../intel/cidr.js';
import { sealResult } from './seal.js';

const key = randomBytes(32);
const k64 = key.toString('base64');
const event = { eventId: 'e1', visitorId: 'v1', suspectScore: 42, expiresAt: '2026-11-15T12:00:00.000Z' } as EventResponse;
const before = new Date('2026-11-15T11:00:00.000Z');

describe('sealed results', () => {
  it('round-trips through the Node SDK', () => {
    const sealed = sealResult(event, key);
    expect(sealed).toMatch(/^[\w-]+$/);
    expect(unsealEventResult(sealed, { key: k64, now: before })).toEqual(event);
  });

  it('accepts any key of a rotation list', () => {
    const sealed = sealResult(event, key);
    expect(unsealEventResult(sealed, { key: [randomBytes(32).toString('base64'), k64], now: before }).eventId).toBe('e1');
  });

  it('rejects altered data, a wrong key, an expired event and bad input', () => {
    const sealed = Buffer.from(sealResult(event, key), 'base64url');
    sealed[20] = sealed[20]! ^ 1;
    const fail = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as SealedResultError).code;
      }
      return 'ok';
    };
    expect(fail(() => unsealEventResult(sealed.toString('base64url'), { key: k64, now: before }))).toBe('tampered');
    expect(fail(() => unsealEventResult(sealResult(event, key), { key: randomBytes(32).toString('base64'), now: before }))).toBe('tampered');
    expect(fail(() => unsealEventResult(sealResult(event, key), { key: k64, now: new Date('2026-11-16T00:00:00Z') }))).toBe('expired');
    expect(fail(() => unsealEventResult('abc', { key: k64 }))).toBe('malformed');
    expect(fail(() => unsealEventResult(sealResult(event, key), { key: 'short' }))).toBe('invalid_key');
  });
});

describe('relay list (CSV)', () => {
  it('reads the first column of Apple-style CSV lines', () => {
    const set = CidrSet.fromText('172.224.226.0/27,GB,GB-EN,London,\n2a02:26f7:b3c0:4000::/64,DE,DE-BE,Berlin,\n');
    expect(set.has('172.224.226.5')).toBe(true);
    expect(set.has('172.224.226.40')).toBe(false);
    expect(set.has('2a02:26f7:b3c0:4000::1')).toBe(true);
  });
});
