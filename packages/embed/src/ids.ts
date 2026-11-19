import { randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Unbiased: bytes >= 248 are rejected so every symbol has probability exactly 1/62. */
export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 20 base62 chars, about 119 bits. */
export function newVisitorId(): string {
  return randomBase62(20);
}

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Time-ordered event id. The embedded millisecond timestamp equals the row's createdAt,
 * so a lookup by id alone can target a single monthly partition.
 */
export function uuidv7(now: Date = new Date()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now.getTime());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv7Time(id: string): Date | null {
  if (!UUID_V7.test(id)) return null;
  const ms = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  return new Date(ms);
}
