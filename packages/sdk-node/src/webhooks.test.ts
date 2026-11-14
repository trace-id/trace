import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from './webhooks.js';

const SECRET = 'whsec_test';
const NOW = new Date('2026-11-14T12:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);
const BODY = JSON.stringify({ id: 'd1', type: 'event.created', createdAt: NOW.toISOString(), data: { eventId: 'e1' } });

const sign = (body: string, ts = TS, secret = SECRET) =>
  `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

describe('verifyWebhook', () => {
  it('accepts a valid signature and returns the payload', () => {
    expect(verifyWebhook({ body: BODY, signature: sign(BODY), secret: SECRET, now: NOW })).toMatchObject({
      id: 'd1',
      type: 'event.created',
    });
    expect(verifyWebhook({ body: Buffer.from(BODY), signature: sign(BODY), secret: SECRET, now: NOW }).id).toBe('d1');
  });

  it('accepts any matching v1 (secret rotation)', () => {
    const other = sign(BODY, TS, 'whsec_old').split(',')[1];
    expect(verifyWebhook({ body: BODY, signature: `${sign(BODY)},${other}`, secret: SECRET, now: NOW }).id).toBe('d1');
  });

  it.each([
    [undefined, 'missing_signature'],
    ['garbage', 'malformed_signature'],
    [`t=${TS}`, 'malformed_signature'],
  ])('rejects header %s with %s', (signature, code) => {
    expect(() => verifyWebhook({ body: BODY, signature, secret: SECRET, now: NOW })).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('rejects tampered bodies, wrong secrets and stale timestamps', () => {
    const cases: [Parameters<typeof verifyWebhook>[0], string][] = [
      [{ body: BODY.replace('e1', 'e2'), signature: sign(BODY), secret: SECRET, now: NOW }, 'invalid_signature'],
      [{ body: BODY, signature: sign(BODY), secret: 'whsec_wrong', now: NOW }, 'invalid_signature'],
      [{ body: BODY, signature: sign(BODY, TS - 301), secret: SECRET, now: NOW }, 'timestamp_out_of_range'],
      [{ body: 'nope', signature: sign('nope'), secret: SECRET, now: NOW }, 'invalid_payload'],
    ];
    for (const [opts, code] of cases) expect(() => verifyWebhook(opts)).toThrow(expect.objectContaining({ code }));
  });
});
