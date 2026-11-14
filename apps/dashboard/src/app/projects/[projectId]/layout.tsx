'use client';

import type { MeResponse } from '@tbdname/signals/api';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { ErrorBox, Loading } from '@/components/ui';
import { ProjectContext } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const NAV = [
  ['', 'Overview'],
  ['/events', 'Events'],
  ['/keys', 'Keys'],
  ['/webhooks', 'Webhooks'],
  ['/settings', 'Settings'],
] as const;

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const me = useApi<MeResponse>('/v1/me');
  const project = me.data?.projects.find((p) => p.id === projectId);

  const ctx = useMemo(
    () => (project ? { project, canEdit: project.role !== 'viewer', reloadProject: me.reload } : null),
    [project, me.reload],
  );

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    window.location.assign('/login');
  }

  const base = `/projects/${projectId}`;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Device intelligence</div>
        {me.data && (
          <select
            aria-label="Project"
            value={projectId}
            onChange={(e) => router.push(e.target.value === 'new' ? '/projects/new' : `/projects/${e.target.value}`)}
            style={{ marginBottom: 12 }}
          >
            {me.data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="new">+ New project</option>
          </select>
        )}
        {NAV.map(([suffix, label]) => {
          const href = `${base}${suffix}`;
          const active = suffix === '' ? pathname === base : pathname.startsWith(href);
          return (
            <Link key={label} href={href} className={`nav${active ? ' active' : ''}`}>
              {label}
            </Link>
          );
        })}
        <div className="spacer" />
        {me.data && <div className="muted small" style={{ padding: '0 8px' }}>{me.data.user.email}</div>}
        <button onClick={signOut} style={{ margin: '8px' }}>
          Sign out
        </button>
      </aside>
      <main className="main">
        {me.loading && !me.data ? (
          <Loading />
        ) : !ctx ? (
          <ErrorBox message={me.error ?? 'Project not found, or you are not a member.'} />
        ) : (
          <ProjectContext.Provider value={ctx}>{children}</ProjectContext.Provider>
        )}
      </main>
    </div>
  );
}
