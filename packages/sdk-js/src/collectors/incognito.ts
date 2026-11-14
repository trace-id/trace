import { type PrivacyIndicators } from '@tbdname/signals/types';
import { safe, safeAsync } from './safe.js';
import { browserFamily } from './ua.js';

const MB = 1024 * 1024;

async function quotaMb(): Promise<number | null> {
  if (!navigator.storage?.estimate) return null;
  const { quota } = await navigator.storage.estimate();
  return typeof quota === 'number' ? Math.round(quota / MB) : null;
}

async function safariPrivate(): Promise<boolean> {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<unknown> };
  if (!storage?.getDirectory) return false;
  try {
    await storage.getDirectory();
    return false;
  } catch (err) {
    return String((err as Error)?.message ?? '').includes('unknown transient reason');
  }
}

/**
 * Heuristics, not proof. Chromium private windows get a quota capped well below the
 * heap limit; Firefox private windows hide serviceWorker; Safari private windows reject OPFS.
 */
export async function readPrivacy(timeoutMs: number): Promise<PrivacyIndicators> {
  const ua = safe(() => navigator.userAgent, '');
  const family = browserFamily(ua);
  const storageQuotaMb = await safeAsync(quotaMb, null, timeoutMs);

  if (family === 'chrome' || family === 'edge' || family === 'opera' || family === 'samsung') {
    const heapLimit = safe(
      () => (performance as Performance & { memory?: { jsHeapSizeLimit: number } }).memory?.jsHeapSizeLimit ?? null,
      null,
    );
    if (storageQuotaMb !== null && heapLimit !== null) {
      const likely = storageQuotaMb * MB < heapLimit * 2;
      return { incognitoLikely: likely, incognitoMethod: likely ? 'quota' : null, storageQuotaMb };
    }
  }
  if (family === 'firefox') {
    const likely = safe(() => window.isSecureContext && !('serviceWorker' in navigator), false);
    return { incognitoLikely: likely, incognitoMethod: likely ? 'serviceWorker' : null, storageQuotaMb };
  }
  if (family === 'safari') {
    const likely = await safeAsync(safariPrivate, false, timeoutMs);
    return { incognitoLikely: likely, incognitoMethod: likely ? 'opfs' : null, storageQuotaMb };
  }
  return { incognitoLikely: false, incognitoMethod: null, storageQuotaMb };
}
