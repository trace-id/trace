'use client';

import type { ApiKeyResponse } from '@tbdname/signals/api';
import { useState, type FormEvent } from 'react';
import { Badge, ConfirmButton, ErrorBox, Loading, SecretOnce } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

function parseOrigins(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean);
}

function OriginsEditor({ k, onSaved }: { k: ApiKeyResponse; onSaved: () => void }) {
  const { project } = useProject();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(k.allowedOrigins.join('\n'));
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <span>
        {k.allowedOrigins.length ? k.allowedOrigins.join(', ') : <span className="muted">none (browser calls refused)</span>}{' '}
        {!k.revokedAt && (
          <button className="small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </span>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} style={{ font: 'inherit', width: '100%' }} />
      <ErrorBox message={error} />
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            try {
              await api(`/v1/projects/${project.id}/keys/${k.id}`, { method: 'PATCH', body: { allowedOrigins: parseOrigins(text) } });
              setEditing(false);
              onSaved();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Save
        </button>
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

export default function KeysPage() {
  const { project, canEdit } = useProject();
  const keys = useApi<{ keys: ApiKeyResponse[] }>(`/v1/projects/${project.id}/keys`);
  const [type, setType] = useState<'public' | 'secret'>('public');
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [created, setCreated] = useState<ApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = type === 'public' ? { type, name: name || undefined, allowedOrigins: parseOrigins(origins) } : { type, name: name || undefined };
      setCreated(await api<ApiKeyResponse>(`/v1/projects/${project.id}/keys`, { method: 'POST', body }));
      setName('');
      setOrigins('');
      keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/v1/projects/${project.id}/keys/${id}/revoke`, { method: 'POST' });
      keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1>Keys</h1>
      <p className="muted">
        Public keys (<code>pk_</code>) go in the browser SDK and only work from their allowed origins. Secret keys (<code>sk_</code>)
        stay on your server and verify events.
      </p>
      <ErrorBox message={error ?? keys.error} />
      {created?.key && (
        <SecretOnce title={`New ${created.type} key`} value={created.key} onDone={() => setCreated(null)} />
      )}
      {canEdit && (
        <form className="panel" onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Create key</h2>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value as 'public' | 'secret')}>
                <option value="public">Public (browser)</option>
                <option value="secret">Secret (server)</option>
              </select>
            </label>
            <label>
              Name
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="e.g. production site" />
            </label>
            {type === 'public' && (
              <label style={{ flex: 1, minWidth: 260 }}>
                Allowed origins (one per line or comma separated)
                <input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://app.example.com, https://*.example.com" />
              </label>
            )}
            <button className="primary" type="submit">
              Create
            </button>
          </div>
        </form>
      )}
      <div className="panel">
        {!keys.data ? (
          <Loading />
        ) : keys.data.keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Allowed origins</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.data.keys.map((k) => (
                <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td>
                    <div className="mono">{k.prefix}…</div>
                    <div className="small muted">{k.name ?? ''}</div>
                  </td>
                  <td>
                    <Badge tone={k.type === 'secret' ? 'warn' : 'neutral'}>{k.type}</Badge>
                  </td>
                  <td className="small">{k.type === 'public' ? canEdit ? <OriginsEditor k={k} onSaved={keys.reload} /> : k.allowedOrigins.join(', ') : '-'}</td>
                  <td className="small">{formatDate(k.createdAt)}</td>
                  <td>
                    {k.revokedAt ? (
                      <Badge tone="bad">revoked</Badge>
                    ) : (
                      canEdit && <ConfirmButton label="Revoke" confirmLabel="Revoke now" onConfirm={() => revoke(k.id)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
