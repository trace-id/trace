'use client';

import { useState, type FormEvent } from 'react';
import { ErrorBox } from '@/components/ui';

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
    <div className="center">
      <form className="panel card" onSubmit={submit}>
        <h1>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</h1>
        {mode === 'sign-up' && (
          <p className="muted small">The first account on a new server becomes its administrator.</p>
        )}
        <div style={{ display: 'grid', gap: 12 }}>
          {mode === 'sign-up' && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            />
          </label>
          <ErrorBox message={error} />
          <button className="primary" type="submit" disabled={busy}>
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
          <button type="button" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
            {mode === 'sign-in' ? 'First time? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
