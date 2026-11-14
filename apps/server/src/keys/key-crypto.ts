import { createHash, timingSafeEqual } from 'node:crypto';
import { randomBase62 } from '../common/ids.js';

export type KeyType = 'public' | 'secret';

const KEY_BODY_LENGTH = 40;
const PREFIX_LENGTH = 11;
const KEY_FORMAT = /^(pk|sk)_[0-9A-Za-z]{40}$/;

export interface GeneratedKey {
  key: string;
  prefix: string;
  hash: string;
}

/** ~238 bits of entropy, so a fast hash (not a password KDF) is the right tool. */
export function generateKey(type: KeyType): GeneratedKey {
  const key = `${type === 'public' ? 'pk' : 'sk'}_${randomBase62(KEY_BODY_LENGTH)}`;
  return { key, prefix: key.slice(0, PREFIX_LENGTH), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function parseKey(key: string): { type: KeyType; prefix: string } | null {
  if (!KEY_FORMAT.test(key)) return null;
  return { type: key.startsWith('pk_') ? 'public' : 'secret', prefix: key.slice(0, PREFIX_LENGTH) };
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
