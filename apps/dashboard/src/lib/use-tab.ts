'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/** The active tab, kept in the address (`?tab=timeline`) so a tab can be linked to and survives a reload. */
export function useTab<T extends string>(fallback: T, valid: readonly T[]): [T, (next: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const value = (valid as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const set = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params.toString());
      if (next === fallback) p.delete('tab');
      else p.set('tab', next);
      const q = p.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, router, pathname, fallback],
  );
  return [value, set];
}
