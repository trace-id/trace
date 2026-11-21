'use client';

import type { MeResponse } from '@trace-id/signals/api';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette, Sidebar, Topbar, usePaletteShortcut, Wordmark } from '@/components/shell/shell';
import { Shortcuts } from '@/components/shell/shortcuts';
import { ToastProvider } from '@/components/ui/toast';
import { ProjectUnavailable } from '@/components/project-unavailable';
import { Skeleton } from '@/components/ui/primitives';
import { ProjectContext } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const RANGE_KEY = 'trace-range';

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useApi<MeResponse>('/v1/me');
  const project = me.data?.projects.find((p) => p.id === projectId);
  const [range, setRangeState] = useState(7);
  const [palette, setPalette] = useState(false);
  usePaletteShortcut(setPalette);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(RANGE_KEY));
      if ([1, 7, 30, 90].includes(saved)) setRangeState(saved);
    } catch {
      /* storage blocked */
    }
  }, []);

  const setRange = useCallback((days: number) => {
    setRangeState(days);
    try {
      localStorage.setItem(RANGE_KEY, String(days));
    } catch {
      /* ignore */
    }
  }, []);

  const ctx = useMemo(
    () =>
      project && me.data
        ? { project, projects: me.data.projects, user: me.data.user, canEdit: project.role !== 'viewer', reloadProject: me.reload, range, setRange }
        : null,
    [project, me.data, me.reload, range, setRange],
  );

  if (!ctx) {
    return (
      <>
        {me.loading && !me.data ? (
          <div className="grid min-h-screen place-items-center px-6">
            <div className="grid w-full max-w-sm justify-items-center gap-6">
              <Wordmark />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ) : (
          <ProjectUnavailable projectId={projectId} me={me.data} error={me.error} onRetry={me.reload} />
        )}
      </>
    );
  }

  return (
    <ProjectContext.Provider value={ctx}>
      <ToastProvider>
      <Shortcuts base={`/projects/${ctx.project.id}`} />
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenPalette={() => setPalette(true)} />
          <main className="mx-auto w-full max-w-[1720px] flex-1 px-4 py-8 sm:px-7 xl:px-10">{children}</main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      </ToastProvider>
    </ProjectContext.Provider>
  );
}
