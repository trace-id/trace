'use client';

import type { ProjectResponse } from '@tbdname/signals/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorBox } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function NewProject() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await api<ProjectResponse>('/v1/projects', { method: 'POST', body: { name } });
      router.push(`/projects/${p.id}/keys`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="center">
      <form className="panel card" onSubmit={create}>
        <h1>New project</h1>
        <ErrorBox message={error} />
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Project name
            <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="primary" type="submit">
            Create project
          </button>
          <Link href="/">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
