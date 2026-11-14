'use client';

import type { VisitorEventSummary, VisitorHistoryResponse } from '@tbdname/signals/api';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EventTable } from '@/components/event-table';
import { ConfirmButton, ErrorBox, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

export default function VisitorPage() {
  const { project, canEdit } = useProject();
  const router = useRouter();
  const { visitorId } = useParams<{ visitorId: string }>();
  const base = `/v1/projects/${project.id}/visitors/${visitorId}`;
  const first = useApi<VisitorHistoryResponse>(`${base}?limit=50`);
  const [extra, setExtra] = useState<VisitorEventSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExtra([]);
    setCursor(first.data?.nextCursor ?? null);
  }, [first.data]);

  async function more() {
    if (!cursor) return;
    try {
      const r = await api<VisitorHistoryResponse>(`${base}?limit=50&cursor=${encodeURIComponent(cursor)}`);
      setExtra((prev) => [...prev, ...r.events]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    try {
      await api(base, { method: 'DELETE' });
      router.push(`/projects/${project.id}/events`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (first.loading) return <Loading />;
  if (!first.data) return <ErrorBox message={first.error ?? 'Not found'} />;
  const v = first.data;

  return (
    <>
      <h1>
        Visitor <span className="mono">{v.visitorId}</span>
      </h1>
      <ErrorBox message={error} />
      <div className="stats">
        <div className="panel stat">
          <div className="muted small">First seen</div>
          <div>{formatDate(v.firstSeenAt)}</div>
        </div>
        <div className="panel stat">
          <div className="muted small">Last seen</div>
          <div>{formatDate(v.lastSeenAt)}</div>
        </div>
        <div className="panel stat">
          <div className="muted small">Events</div>
          <div className="value">{v.eventCount}</div>
        </div>
      </div>
      <div className="panel">
        <EventTable projectId={project.id} events={[...v.events, ...extra]} showVisitor={false} />
        {cursor && (
          <button onClick={more} style={{ marginTop: 12 }}>
            Load more
          </button>
        )}
      </div>
      {canEdit && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Delete visitor</h2>
          <p className="muted small">
            Permanently deletes this visitor and all its events, for example to honour a deletion request. This cannot be undone.
          </p>
          <ConfirmButton label="Delete visitor" confirmLabel="Delete permanently" onConfirm={remove} />
        </div>
      )}
    </>
  );
}
