'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'trace-theme';
const Ctx = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({ choice: 'system', setChoice: () => undefined });

function apply(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Runs before first paint so there is no flash of the wrong theme. */
export const THEME_SCRIPT = `try{var c=localStorage.getItem('${KEY}')||'system';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as ThemeChoice | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') setChoiceState(saved);
    } catch {
      /* storage blocked: stay on system */
    }
  }, []);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  return <Ctx.Provider value={{ choice, setChoice }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
