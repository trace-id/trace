'use client';

import type { MeResponse } from '@trace-id/signals/api';
import { ArrowRight, FolderSearch, LogOut, Plus, RotateCw, ServerCrash } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '@/components/shell/shell';
import { Button, Card } from '@/components/ui/primitives';

async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  window.location.assign('/login');
}

/**
 * Shown instead of a project page when it cannot be opened. Two different situations: the server could not be asked
 * (a network or server problem: retry), or it answered and this account has no such project (a stale or foreign link,
 * a deleted project, or the wrong account: say so, and offer the projects that do exist).
 */
export function ProjectUnavailable({ projectId, me, error, onRetry }: { projectId: string; me: MeResponse | null; error: string | null; onRetry: () => void }) {
  if (!me) {
    return (
      <Shell>
        <Card className="p-7 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-bad-soft text-bad"><ServerCrash className="size-6" /></span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">We could not reach the server</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">The dashboard could not load your account. This is usually a network problem or a server that is starting up; a free-tier server can take a minute to wake.</p>
          {error && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink-3">{error}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={onRetry}><RotateCw className="size-3.5" /> Try again</Button>
            <Button variant="outline" onClick={() => void signOut()}><LogOut className="size-3.5" /> Sign out</Button>
          </div>
        </Card>
      </Shell>
    );
  }

  const projects = me.projects;
  return (
    <Shell>
      <Card className="overflow-hidden">
        <div className="p-7">
          <span className="grid size-12 place-items-center rounded-2xl bg-warn-soft text-warn"><FolderSearch className="size-6" /></span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">This project is not available to you</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
            You are signed in as <b className="text-ink">{me.user.email}</b>, and that account has no project with this address. Usually one of these:
          </p>
          <ul className="mt-3 grid gap-1.5 text-[13px] text-ink-2">
            <li className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />The link is old, or came from a different Trace server.</li>
            <li className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />The project was deleted, or you were removed from it.</li>
            <li className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />You are signed in as a different person than the one who was invited.</li>
          </ul>
          <p className="mt-4 truncate font-mono text-[11px] text-ink-3" title={projectId}>Project id: {projectId}</p>
        </div>

        <div className="border-t border-line bg-surface-2/50 p-5">
          {projects.length > 0 ? (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Your projects</p>
              <ul className="grid gap-1.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] transition-colors hover:border-signal">
                      <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.name}</span><span className="text-xs text-ink-3">{p.role}</span></span>
                      <ArrowRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-signal" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-ink-2">This account has no projects yet.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant={projects.length > 0 ? 'outline' : 'primary'}><Link href="/projects/new"><Plus className="size-3.5" /> New project</Link></Button>
            <Button variant="ghost" onClick={() => void signOut()}><LogOut className="size-3.5" /> Sign in as someone else</Button>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 py-10">
      <div className="grid w-full max-w-lg gap-6">
        <div className="flex justify-center"><Wordmark /></div>
        {children}
      </div>
    </div>
  );
}
