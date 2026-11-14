'use client';

import type { VisitorEventSummary } from '@tbdname/signals/api';
import Link from 'next/link';
import { formatDate, shortId } from '@/lib/format';
import { Badge, ScoreBadge } from './ui';

export function EventTable({
  projectId,
  events,
  showVisitor = true,
}: {
  projectId: string;
  events: (VisitorEventSummary & { visitorId?: string })[];
  showVisitor?: boolean;
}) {
  if (events.length === 0) return <p className="muted">No events.</p>;
  const base = `/projects/${projectId}`;
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          {showVisitor && <th>Visitor</th>}
          <th>Score</th>
          <th>Match</th>
          <th>Linked id</th>
          <th>Event</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.eventId}>
            <td>{formatDate(e.createdAt)}</td>
            {showVisitor && (
              <td className="mono">
                {e.visitorId ? <Link href={`${base}/visitors/${e.visitorId}`}>{shortId(e.visitorId, 10)}</Link> : '-'}
              </td>
            )}
            <td>
              <ScoreBadge score={e.suspectScore} />
            </td>
            <td>
              <Badge>{e.matchKind}</Badge> <span className="muted small">{Math.round(e.confidence * 100)}%</span>
            </td>
            <td className="mono">{e.linkedId ?? <span className="muted">-</span>}</td>
            <td className="mono">
              <Link href={`${base}/events/${e.eventId}`}>{shortId(e.eventId, 13)}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
