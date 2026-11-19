'use client';

import type { ProjectResponse } from '@trace-id/signals/api';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Wordmark } from '@/components/shell/shell';
import { Button, Card, ErrorBanner, Field, Input } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';

export default function NewProject() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<ProjectResponse>('/v1/projects', { method: 'POST', body: { name } });
      router.push(`/projects/${p.id}/setup`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <Card className="p-7">
          <h1 className="text-xl font-semibold tracking-tight">Create a project</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">A project holds one site or app: its events, visitors, keys and webhooks. You can run staging and production as separate projects.</p>
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <Field label="Project name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus placeholder="Acme checkout" />
            </Field>
            <ErrorBanner message={error} />
            <Button variant="primary" size="lg" type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-xs text-ink-3">Next: create keys and add the SDK.</p>
      </div>
    </div>
  );
}
