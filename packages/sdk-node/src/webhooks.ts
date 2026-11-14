import { createHmac, timingSafeEqual } from 'node:crypto';
import { type WebhookPayload } from '@tbdname/signals/api';

export type WebhookErrorCode =
  | 'missing_signature'
  | 'malformed_signature'
  | 'timestamp_out_of_range'
  | 'invalid_signature'
  | 'invalid_payload';

export class WebhookVerificationError extends Error {
  readonly code: WebhookErrorCode;

  constructor(code: WebhookErrorCode, message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
  }
}

export interface VerifyWebhookOptions {
  /** The raw request body exactly as received. Re-serialized JSON will not verify. */
  body: string | Buffer;
  /** Value of the `X-Signature` header: `t=<unix seconds>,v1=<hex hmac>[,v1=...]`. */
  signature: string | undefined | null;
  /** The endpoint's `whsec_...` secret. */
  secret: string;
  /** Maximum age (and clock skew) accepted, in seconds. Default 300. */
  toleranceSec?: number;
  now?: Date;
}

/**
 * Verifies an incoming webhook and returns its parsed payload. Rejects stale timestamps to
 * limit replay; deliveries are at-least-once, so also dedupe on `payload.id`.
 */
export function verifyWebhook(options: VerifyWebhookOptions): WebhookPayload {
  const header = options.signature;
  if (!header) throw new WebhookVerificationError('missing_signature', 'Missing X-Signature header');

  let timestamp: number | null = null;
  const macs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && v && /^[0-9a-f]{64}$/.test(v)) macs.push(v);
  }
  if (timestamp === null || macs.length === 0) {
    throw new WebhookVerificationError('malformed_signature', 'X-Signature is malformed');
  }

  const tolerance = options.toleranceSec ?? 300;
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > tolerance) {
    throw new WebhookVerificationError('timestamp_out_of_range', 'Webhook timestamp is outside the tolerance');
  }

  const body = typeof options.body === 'string' ? options.body : options.body.toString('utf8');
  const expected = createHmac('sha256', options.secret).update(`${timestamp}.${body}`).digest();
  const valid = macs.some((mac) => {
    const presented = Buffer.from(mac, 'hex');
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
  if (!valid) throw new WebhookVerificationError('invalid_signature', 'Webhook signature does not match');

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new WebhookVerificationError('invalid_payload', 'Webhook body is not JSON');
  }
  const p = payload as Partial<WebhookPayload> | null;
  if (!p || typeof p.id !== 'string' || typeof p.type !== 'string' || typeof p.data !== 'object' || p.data === null) {
    throw new WebhookVerificationError('invalid_payload', 'Webhook body has an unexpected shape');
  }
  return p as WebhookPayload;
}
