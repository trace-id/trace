'use client';

import type { EventSearchResponse, UsageResponse } from '@tbdname/signals/api';
import Link from 'next/link';
import { EventTable } from '@/components/event-table';
import { ErrorBox, Loading } from '@/components/ui';
import { UsageChart } from '@/components/usage-chart';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

export default function Overview() {
  const { project } = useProject();
  const usage = useApi<UsageResponse>(`/v1/projects/${project.id}/usage?days=30`);
  const suspicious = useApi<EventSearchResponse>(`/v1/projects/${project.id}/events?minScore=70&limit=10`);
  const totals = usage.data?.days.reduce(
    (t, d) => ({ events: t.events + d.events, newVisitors: t.newVisitors + d.newVisitors, suspicious: t.suspicious + d.suspicious }),
    { events: 0, newVisitors: 0, suspicious: 0 },
  );

  return (
    <>
      <h1>{project.name}</h1>
      <ErrorBox message={usage.error ?? suspicious.error} />
      {totals && (
        <div className="stats">
          <div className="panel stat">
            <div className="muted small">Events, last 30 days</div>
            <div className="value">{totals.events.toLocaleString()}</div>
          </div>
          <div className="panel stat">
            <div className="muted small">New visitors</div>
            <div className="value">{totals.newVisitors.toLocaleString()}</div>
          </div>
          <div className="panel stat">
            <div className="muted small">Suspicious (score ≥ {usage.data?.suspiciousThreshold})</div>
            <div className="value">{totals.suspicious.toLocaleString()}</div>
          </div>
        </div>
      )}
      <div className="panel">
        <div className="muted small">Events per day (red: suspicious)</div>
        {usage.data ? <UsageChart days={usage.data.days} /> : <Loading />}
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Recent suspicious events</h2>
          <Link href={`/projects/${project.id}/events?minScore=70`}>All</Link>
        </div>
        {suspicious.data ? <EventTable projectId={project.id} events={suspicious.data.events} /> : <Loading />}
      </div>
      {totals?.events === 0 && (
        <div className="notice">
          No events yet. Create a public key under <Link href={`/projects/${project.id}/keys`}>Keys</Link> and add the
          browser SDK to your site.
        </div>
      )}
    </>
  );
}
