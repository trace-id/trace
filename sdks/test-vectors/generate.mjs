// Generates vectors.json: one set of inputs and expected outputs every server SDK is tested against.
// The key and secret below are test values used only here. Run: node sdks/test-vectors/generate.mjs
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sealResult } from '../../apps/server/dist/identify/seal.js';

const key = Buffer.alloc(32, 7); // test-only key: 32 bytes of 0x07
const event = {
  eventId: '01a1dcf6-53b8-7c68-bd1d-65941803eae7',
  visitorId: 'LKf5TfnSd3QB5FPbT13g',
  deviceId: 'LKf5TfnSd3QB5FPbT13g',
  confidence: 0.99,
  matchKind: 'token',
  suspectScore: 75,
  reasons: [{ signal: 'bot', contribution: 60 }, { signal: 'virtualMachine', contribution: 15 }],
  signals: { bot: { detected: true, details: { headlessUserAgent: true } } },
  createdAt: '2026-11-15T12:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const sealed = sealResult(event, key);
const tampered = Buffer.from(sealed, 'base64url');
tampered[25] ^= 1;
const expired = sealResult({ ...event, expiresAt: '2001-01-01T00:00:00.000Z' }, key);

const secret = 'whsec_test_only_0123456789abcdef';
const body = JSON.stringify({ id: 'wh_1', type: 'event.created', createdAt: '2026-11-15T12:00:00.000Z', data: event });
const t = 1794744000;
const mac = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

writeFileSync(
  new URL('./vectors.json', import.meta.url),
  `${JSON.stringify(
    {
      note: 'Test values only. Regenerate with: node sdks/test-vectors/generate.mjs',
      sealed: { key: key.toString('base64'), valid: sealed, tampered: tampered.toString('base64url'), expired, expect: { eventId: event.eventId, suspectScore: 75 } },
      webhook: { secret, body, timestamp: t, signature: `t=${t},v1=${mac}`, badSignature: `t=${t},v1=${'0'.repeat(64)}`, nowAccepted: t + 10, nowTooLate: t + 301 },
      eventId: { valid: event.eventId, invalid: 'not-an-id' },
    },
    null,
    2,
  )}\n`,
);
console.log('wrote vectors.json');
