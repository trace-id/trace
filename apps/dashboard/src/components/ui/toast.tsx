'use client';

import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

const Ctx = createContext<{ toast: (t: Omit<Toast, 'id'>) => void }>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setItems((cur) => [...cur.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  const Icon = { ok: CheckCircle2, error: TriangleAlert, info: Info };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] grid w-[min(380px,calc(100vw-32px))] gap-2">
        {items.map((t) => {
          const I = Icon[t.tone];
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop [animation:pop-in_.18s_ease-out]">
              <I className={cn('mt-0.5 size-[18px] shrink-0', t.tone === 'ok' ? 'text-ok' : t.tone === 'error' ? 'text-bad' : 'text-info')} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-ink-3">{t.description}</p>}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="cursor-pointer rounded-md p-0.5 text-ink-3 hover:text-ink">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx).toast;
}
