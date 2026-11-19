'use client';

import type { MeResponse, ProjectResponse } from '@trace-id/signals/api';
import { createContext, useContext } from 'react';

export interface ProjectContextValue {
  project: ProjectResponse;
  projects: ProjectResponse[];
  user: MeResponse['user'];
  canEdit: boolean;
  reloadProject: () => void;
  /** Time window for analytics pages, in days. */
  range: number;
  setRange: (days: number) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProject outside a project page');
  return value;
}

export const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
] as const;
