'use client';

import { Fingerprint, ShieldCheck, Radar } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Mark } from '@/components/shell/shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui/primitives';

type Mode = 'sign-in' | 'sign-up';

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}/email`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'sign-up' ? { email, password, name: name || email.split('@')[0] } : { email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(
          res.status === 403 && mode === 'sign-up'
            ? 'Sign-up is closed on this server. Ask an existing admin for an account.'
            : (body?.message ?? 'Sign-in failed'),
        );
        return;
      }
      window.location.assign(safeNext());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#111318] p-12 text-[#eceef1] lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-40 -top-40 size-[520px] rounded-full bg-[#2b3fd6]/30 blur-3xl" />
        <div className="absolute -bottom-52 -left-32 size-[480px] rounded-full bg-[#e2f04f]/[0.07] blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <Mark size={32} />
          <span className="text-lg font-bold tracking-tight">trace</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-tight">Know who is really on the other side of the request.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#aab0ba]">Device identification and fraud signals you host yourself. Every score comes with the reasons behind it.</p>
          <ul className="mt-9 grid gap-4 text-sm text-[#aab0ba]">
            {[
              [Fingerprint, 'Recognise returning devices across cleared cookies, incognito and browser switches'],
              [Radar, 'Bots, VPNs, tampering and anti-detect browsers, scored with explanations'],
              [ShieldCheck, 'Your data stays on your infrastructure'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Fingerprint;
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[#e2f04f]">
                    <I className="size-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-[#6f7782]">Open source · self-hosted</p>
      </aside>
      <main className="grid place-items-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Mark />
            <b className="text-lg font-bold tracking-tight">trace</b>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">
            {mode === 'sign-in' ? 'Sign in to your Trace dashboard.' : 'The first account on a new server becomes its administrator.'}
          </p>
          <div className="mt-7 grid gap-4">
            {mode === 'sign-up' && (
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
            </Field>
            <Field label="Password" hint={mode === 'sign-up' ? 'At least 12 characters.' : undefined}>
              <Input
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              />
            </Field>
            <ErrorBanner message={error} />
            <Button variant="primary" size="lg" type="submit" disabled={busy}>
              {busy ? 'One moment…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </Button>
          </div>
          <button type="button" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')} className="mt-5 cursor-pointer text-[13px] text-ink-3 hover:text-ink">
            {mode === 'sign-in' ? 'First time here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}
