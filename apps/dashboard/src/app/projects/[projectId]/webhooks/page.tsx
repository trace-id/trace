'use client';

import type { WebhookEndpointResponse, WebhookType } from '@tbdname/signals/api';
import { useState, type FormEvent } from 'react';
import { Badge, ConfirmButton, ErrorBox, Loading, SecretOnce } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, shortId } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

interface Delivery {
  id: string;
  eventId: string;
  type: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  succeeded: 'ok',
  pending: 'warn',
  dead: 'bad',
  cancelled: 'neutral',
};

function Deliveries({ endpointId }: { endpointId: string }) {
  const { project } = useProject();
  const d = useApi<{ deliveries: Delivery[] }>(`/v1/projects/${project.id}/webhooks/${endpointId}/deliveries`);
  if (d.loading) return <Loading />;
  if (!d.data) return <ErrorBox message={d.error} />;
  if (d.data.deliveries.length === 0) return <p className="muted small">No deliveries yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Last result</th>
          <th>Event</th>
        </tr>
      </thead>
      <tbody>
        {d.data.deliveries.map((x) => (
          <tr key={x.id}>
            <td className="small">{formatDate(x.createdAt)}</td>
            <td className="small">{x.type}</td>
            <td>
              <Badge tone={TONE[x.status] ?? 'neutral'}>{x.status}</Badge>
              {x.status === 'pending' && x.attempts > 0 && <div className="small muted">next {formatDate(x.nextAttemptAt)}</div>}
            </td>
            <td>{x.attempts}</td>
            <td className="mono small">{x.lastError ?? x.lastStatus ?? '-'}</td>
            <td className="mono small">{shortId(x.eventId, 13)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function WebhooksPage() {
  const { project, canEdit } = useProject();
  const list = useApi<{ endpoints: WebhookEndpointResponse[] }>(`/v1/projects/${project.id}/webhooks`);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookType[]>(['event.created']);
  const [threshold, setThreshold] = useState(70);
  const [created, setCreated] = useState<WebhookEndpointResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(t: WebhookType) {
    setEvents((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setCreated(
        await api<WebhookEndpointResponse>(`/v1/projects/${project.id}/webhooks`, {
          method: 'POST',
          body: { url, events, flagThreshold: threshold },
        }),
      );
      setUrl('');
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(id: string) {
    try {
      await api(`/v1/projects/${project.id}/webhooks/${id}`, { method: 'DELETE' });
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1>Webhooks</h1>
      <p className="muted">
        Signed <code>POST</code> requests to your server. Verify them with <code>verifyWebhook</code> from{' '}
        <code>@tbdname/sdk-node/webhooks</code>.
      </p>
      <ErrorBox message={error ?? list.error} />
      {created?.secret && <SecretOnce title="Webhook signing secret" value={created.secret} onDone={() => setCreated(null)} />}
      {canEdit && (
        <form className="panel" onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Add endpoint</h2>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: 280 }}>
              URL (https)
              <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/hooks/device" />
            </label>
            <label>
              Flag threshold
              <input type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 90 }} />
            </label>
            <button className="primary" type="submit" disabled={events.length === 0}>
              Add
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {(['event.created', 'visitor.flagged'] as const).map((t) => (
              <label key={t} style={{ flexDirection: 'row', alignItems: 'center', color: 'var(--text)' }}>
                <input type="checkbox" checked={events.includes(t)} onChange={() => toggle(t)} /> {t}
              </label>
            ))}
          </div>
        </form>
      )}
      {!list.data ? (
        <Loading />
      ) : list.data.endpoints.length === 0 ? (
        <p className="muted">No endpoints.</p>
      ) : (
        list.data.endpoints.map((ep) => (
          <div className="panel" key={ep.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="mono">{ep.url}</div>
                <div className="small muted">
                  {ep.events.join(', ')}
                  {ep.events.includes('visitor.flagged') && ` (flag at score ≥ ${ep.flagThreshold})`} · added {formatDate(ep.createdAt)}
                </div>
              </div>
              <div className="row">
                <button onClick={() => setOpen(open === ep.id ? null : ep.id)}>{open === ep.id ? 'Hide deliveries' : 'Deliveries'}</button>
                {canEdit && <ConfirmButton label="Delete" confirmLabel="Delete endpoint" onConfirm={() => remove(ep.id)} />}
              </div>
            </div>
            {open === ep.id && (
              <div style={{ marginTop: 12 }}>
                <Deliveries endpointId={ep.id} />
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}
