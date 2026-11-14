'use client';

import type { ProjectResponse } from '@tbdname/signals/api';
import { createContext, useContext } from 'react';

export interface ProjectContextValue {
  project: ProjectResponse;
  canEdit: boolean;
  reloadProject: () => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProject outside a project page');
  return value;
}
