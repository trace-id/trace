'use client';

import type { ProjectResponse } from '@tbdname/signals/api';
import { useState, type FormEvent } from 'react';
import { ErrorBox } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useProject } from '@/lib/project-context';

export default function SettingsPage() {
  const { project, canEdit, reloadProject } = useProject();
  const [name, setName] = useState(project.name);
  const [retentionDays, setRetentionDays] = useState(project.retentionDays);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api<ProjectResponse>(`/v1/projects/${project.id}`, { method: 'PATCH', body: { name, retentionDays } });
      setSaved(true);
      reloadProject();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1>Settings</h1>
      <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <label>
          Project name
          <input required maxLength={200} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Retention (days)
          <input
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            disabled={!canEdit}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
          <span className="small">Events and inactive visitors older than this are deleted. The server may enforce a lower maximum.</span>
        </label>
        <ErrorBox message={error} />
        {saved && <p className="small" style={{ color: 'var(--ok)' }}>Saved.</p>}
        {canEdit ? (
          <button className="primary" type="submit">
            Save
          </button>
        ) : (
          <p className="muted small">You have read-only access to this project.</p>
        )}
      </form>
      <div className="panel">
        <div className="muted small">Project id</div>
        <div className="mono">{project.id}</div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Your role
        </div>
        <div>{project.role}</div>
      </div>
    </>
  );
}
