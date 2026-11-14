import { UUID_V7 } from './ids.js';

export interface EventCursor {
  createdAt: Date;
  id: string;
}

/** Opaque to clients; encodes the last row of a page (createdAt, id) for keyset pagination. */
export function encodeCursor(c: EventCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): EventCursor | null {
  if (value.length > 200 || !/^[\w-]+$/.test(value)) return null;
  const [iso = '', id = ''] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso || !UUID_V7.test(id)) return null;
  return { createdAt, id };
}

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export function parseLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_PAGE_SIZE ? n : null;
}
