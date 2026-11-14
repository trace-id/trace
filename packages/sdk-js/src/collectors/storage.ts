import { type StorageAvailability } from '@tbdname/signals/types';
import { safe, safeAsync } from './safe.js';

const KEY = '_dvi_vt';
const DB_NAME = '_dvi';
const STORE = 'kv';
const MAX_TOKEN_LENGTH = 512;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function readAvailability(): StorageAvailability {
  return {
    cookie: safe(() => navigator.cookieEnabled === true, false),
    localStorage: safe(() => {
      localStorage.setItem(`${KEY}_probe`, '1');
      localStorage.removeItem(`${KEY}_probe`);
      return true;
    }, false),
    indexedDb: safe(() => typeof indexedDB !== 'undefined' && indexedDB !== null, false),
  };
}

function valid(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH && /^[\w.-]+$/.test(token);
}

function readCookie(): string | null {
  return safe(() => {
    const match = document.cookie.split('; ').find((c) => c.startsWith(`${KEY}=`));
    return match ? decodeURIComponent(match.slice(KEY.length + 1)) : null;
  }, null);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

async function idbGet(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
    });
  } finally {
    db.close();
  }
}

async function idbSet(value: string | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (value === null) store.delete(KEY);
      else store.put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

export async function loadToken(timeoutMs: number): Promise<string | null> {
  const local = safe(() => localStorage.getItem(KEY), null);
  if (valid(local)) return local;
  const cookie = readCookie();
  if (valid(cookie)) return cookie;
  const idb = await safeAsync(idbGet, null, timeoutMs);
  return valid(idb) ? idb : null;
}

export async function saveToken(token: string, timeoutMs: number): Promise<void> {
  if (!valid(token)) return;
  safe(() => localStorage.setItem(KEY, token), undefined);
  safe(() => {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${KEY}=${encodeURIComponent(token)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  }, undefined);
  await safeAsync(() => idbSet(token), undefined, timeoutMs);
}

export async function clearToken(timeoutMs: number): Promise<void> {
  safe(() => localStorage.removeItem(KEY), undefined);
  safe(() => {
    document.cookie = `${KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
  }, undefined);
  await safeAsync(() => idbSet(null), undefined, timeoutMs);
}
