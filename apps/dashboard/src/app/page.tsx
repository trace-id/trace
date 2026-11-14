'use client';

import type { MeResponse, ProjectResponse } from '@tbdname/signals/api';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorBox, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function Home() {
  const router = useRouter();
  const me = useApi<MeResponse>('/v1/me');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const first = me.data?.projects[0];
  useEffect(() => {
    if (first) router.replace(`/projects/${first.id}`);
  }, [first, router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await api<ProjectResponse>('/v1/projects', { method: 'POST', body: { name } });
      router.push(`/projects/${p.id}/keys`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (me.loading || first) return <div className="center"><Loading /></div>;
  return (
    <div className="center">
      <form className="panel card" onSubmit={create}>
        <h1>Create your first project</h1>
        <p className="muted small">A project holds keys, visitors and events for one site or app.</p>
        <ErrorBox message={me.error ?? error} />
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Project name
            <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="primary" type="submit">
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
