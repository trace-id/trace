'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { Kbd } from '@/components/ui/primitives';

const GO: Record<string, string> = {
  o: '',
  e: '/events',
  v: '/visitors',
  a: '/accounts',
  i: '/investigate',
  p: '/policy',
  s: '/signals',
  q: '/quality',
  k: '/keys',
};

const LIST: [string[], string][] = [
  [['⌘', 'K'], 'Open the command palette'],
  [['/'], 'Search'],
  [['?'], 'Show this help'],
  [['g', 'o'], 'Go to Overview'],
  [['g', 'e'], 'Go to Events'],
  [['g', 'v'], 'Go to Visitors'],
  [['g', 'a'], 'Go to Accounts'],
  [['g', 'i'], 'Go to Investigate'],
  [['g', 'p'], 'Go to Policy'],
  [['g', 's'], 'Go to Signals'],
  [['g', 'q'], 'Go to Data quality'],
  [['j', 'k'], 'Move down and up in a table'],
  [['↵'], 'Open the highlighted row'],
  [['x'], 'Select the highlighted row'],
];

/** `g` then a letter jumps between pages; `?` opens the cheat sheet. Ignored while typing in a field. */
export function Shortcuts({ base }: { base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const armed = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (armed.current && Date.now() - armed.current < 1200) {
        armed.current = null;
        const dest = GO[e.key.toLowerCase()];
        if (dest !== undefined) {
          e.preventDefault();
          router.push(`${base}${dest}`);
        }
        return;
      }
      if (e.key.toLowerCase() === 'g') armed.current = Date.now();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [base, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" className="max-w-lg">
        <ul className="grid gap-0.5">
          {LIST.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between rounded-lg px-1 py-2 text-[13px]">
              <span className="text-ink-2">{label}</span>
              <span className="flex items-center gap-1">
                {keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && keys.length === 2 && keys[0] === 'g' && <span className="text-xs text-ink-3">then</span>}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** j/k to move a highlight through table rows, Enter to open, x to select. Returns the highlighted index. */
export function useRowNav(count: number, onOpen: (i: number) => void, onToggle?: (i: number) => void): [number, (i: number) => void] {
  const [index, setIndex] = useState(-1);
  useEffect(() => setIndex(-1), [count]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'j') setIndex((i) => Math.min(count - 1, i + 1));
      else if (e.key === 'k') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'Enter' && index >= 0) onOpen(index);
      else if (e.key === 'x' && index >= 0) onToggle?.(index);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, index, onOpen, onToggle]);
  return [index, setIndex];
}
