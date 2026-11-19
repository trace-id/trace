import { createDecipheriv } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { type EventResponse } from '@trace-id/signals/api';

export type SealedErrorCode = 'invalid_key' | 'malformed' | 'unsupported_version' | 'tampered' | 'expired';

export class SealedResultError extends Error {
  constructor(
    readonly code: SealedErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SealedResultError';
  }
}

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from('trace-sealed-v1');

export interface UnsealOptions {
  /** The server's SEALED_RESULTS_KEY (base64 of 32 bytes). Several keys may be given during a rotation. */
  key: string | string[];
  /** Reject events whose verification window has passed (default true). */
  checkExpiry?: boolean;
  now?: Date;
}

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new SealedResultError('invalid_key', 'The key must be base64 of exactly 32 bytes');
  return bytes;
}

function open(sealed: Buffer, key: Buffer): Buffer | null {
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(1 + IV_BYTES, sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
}

/**
 * Decrypts the `sealedResult` from an identify response: the full server-side event, readable on your backend without
 * calling `GET /v1/events`. Authenticated encryption, so a client cannot alter it; still treat `eventId` as single-use
 * (store the ids you have accepted) to stop a sealed result from being replayed within its window.
 */
export function unsealEventResult(sealedResult: string, options: UnsealOptions): EventResponse {
  const keys = (Array.isArray(options.key) ? options.key : [options.key]).map(keyBytes);
  const sealed = Buffer.from(sealedResult, 'base64url');
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES + 1) throw new SealedResultError('malformed', 'Sealed result is too short');
  if (sealed[0] !== VERSION) throw new SealedResultError('unsupported_version', `Unsupported sealed result version ${sealed[0]}`);
  let plain: Buffer | null = null;
  for (const key of keys) {
    plain = open(sealed, key);
    if (plain) break;
  }
  if (!plain) throw new SealedResultError('tampered', 'Sealed result failed authentication (wrong key or altered)');
  let event: EventResponse;
  try {
    event = JSON.parse(inflateRawSync(plain).toString('utf8')) as EventResponse;
  } catch {
    throw new SealedResultError('malformed', 'Sealed result content is not valid');
  }
  if (options.checkExpiry !== false) {
    const now = options.now ?? new Date();
    if (new Date(event.expiresAt).getTime() < now.getTime()) {
      throw new SealedResultError('expired', 'The event is past its verification window');
    }
  }
  return event;
}
