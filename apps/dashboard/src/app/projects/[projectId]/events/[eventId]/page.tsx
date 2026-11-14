'use client';

import type { EventResponse } from '@tbdname/signals/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, ErrorBox, Loading, ScoreBadge } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

export default function EventDetail() {
  const { project } = useProject();
  const { eventId } = useParams<{ eventId: string }>();
  const ev = useApi<EventResponse>(`/v1/projects/${project.id}/events/${eventId}`);

  if (ev.loading) return <Loading />;
  if (!ev.data) return <ErrorBox message={ev.error ?? 'Not found'} />;
  const e = ev.data;
  const signals = Object.entries(e.signals).sort(([, a], [, b]) => Number(b.detected) - Number(a.detected));

  return (
    <>
      <h1>
        Event <span className="mono">{e.eventId}</span>
      </h1>
      <div className="stats">
        <div className="panel stat">
          <div className="muted small">Suspect score</div>
          <div className="value">
            <ScoreBadge score={e.suspectScore} />
          </div>
        </div>
        <div className="panel stat">
          <div className="muted small">Visitor</div>
          <div className="mono">
            <Link href={`/projects/${project.id}/visitors/${e.visitorId}`}>{e.visitorId}</Link>
          </div>
          <div className="small">
            <Badge>{e.matchKind}</Badge> {Math.round(e.confidence * 100)}% confidence
          </div>
        </div>
        <div className="panel stat">
          <div className="muted small">When</div>
          <div>{formatDate(e.createdAt)}</div>
          {e.linkedId && <div className="small mono">linkedId: {e.linkedId}</div>}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Why this score</h2>
        {e.reasons.length === 0 ? (
          <p className="muted">No signals contributed.</p>
        ) : (
          <table>
            <tbody>
              {e.reasons.map((r) => (
                <tr key={r.signal}>
                  <td>{r.signal}</td>
                  <td>+{r.contribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Signals</h2>
        <table>
          <tbody>
            {signals.map(([id, s]) => (
              <tr key={id}>
                <td style={{ width: 160 }}>{id}</td>
                <td style={{ width: 100 }}>{s.detected ? <Badge tone="bad">detected</Badge> : <Badge tone="ok">no</Badge>}</td>
                <td className="mono small">{Object.keys(s.details).length ? JSON.stringify(s.details) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Device and network</h2>
        <table>
          <tbody>
            <tr>
              <td style={{ width: 160 }}>User agent</td>
              <td className="mono small">{e.attributes.userAgent ?? '-'}</td>
            </tr>
            <tr>
              <td>Screen</td>
              <td>{e.attributes.screenWidth && e.attributes.screenHeight ? `${e.attributes.screenWidth} × ${e.attributes.screenHeight}` : '-'}</td>
            </tr>
            <tr>
              <td>Timezone / languages</td>
              <td>
                {e.attributes.timezone ?? '-'} / {e.attributes.languages.join(', ') || '-'}
              </td>
            </tr>
            <tr>
              <td>Platform</td>
              <td>{e.attributes.platform ?? '-'}</td>
            </tr>
            <tr>
              <td>IP (as stored)</td>
              <td className="mono">{e.ip.address ?? '-'}</td>
            </tr>
            <tr>
              <td>Tags</td>
              <td className="mono small">{e.tags ? JSON.stringify(e.tags) : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
