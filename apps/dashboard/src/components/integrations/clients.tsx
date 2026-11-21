'use client';

import type { ClientsResponse } from '@trace-id/signals/api';
import { Boxes } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Segmented, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { clientName } from '@/lib/clients';
import { compact, num, timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

/** Which client packages (and versions) the events of this project came from. */
export function Clients() {
  const { project } = useProject();
  const [days, setDays] = useState(30);
  const c = useApi<ClientsResponse>(`/v1/projects/${project.id}/clients?days=${days}`, { intervalMs: 60_000 });
  const rows = c.data?.clients ?? [];
  const total = rows.reduce((n, r) => n + r.events, 0);
  const packages = new Set(rows.map((r) => r.name)).size;

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader
          title="Where events come from"
          description="The package each event was sent by, with its version. Framework packages are shown as themselves, with the engine underneath."
          action={<Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }]} />}
        />
        <ErrorBanner message={c.error} />
        {!c.data ? <Skeleton className="m-5 h-40" /> : rows.length === 0 ? (
          <EmptyState icon={<Boxes className="size-5" />} title="No events in this window" description="Events appear here as soon as a page or app using one of the SDKs identifies a visitor." />
        ) : (
          <>
            <p className="px-5 pb-3 text-[13px] text-ink-2">{num(total)} events from {packages} client package{packages === 1 ? '' : 's'}.</p>
            <Table>
              <thead><tr><Th>Client</Th><Th>Version</Th><Th>Events</Th><Th>Visitors</Th><Th>Flagged</Th><Th>Last seen</Th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const wrapped = r.engine.name !== r.name;
                  return (
                    <Tr key={`${r.name}@${r.version}@${r.engine.name}@${r.engine.version}`}>
                      <Td>
                        <span className="block text-[13px] font-medium text-ink">{clientName(r.name)}</span>
                        <span className="font-mono text-xs text-ink-3">{r.name}{wrapped && <> on {clientName(r.engine.name)} {r.engine.version}</>}</span>
                      </Td>
                      <Td className="font-mono text-xs">{r.version || '-'}</Td>
                      <Td>
                        <div className="min-w-[120px]">
                          <span className="tnum text-[13px] font-semibold text-ink">{compact(r.events)}</span>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-signal" style={{ width: `${total > 0 ? (r.events / total) * 100 : 0}%` }} /></div>
                        </div>
                      </Td>
                      <Td className="tnum">{compact(r.visitors)}</Td>
                      <Td>{r.suspicious > 0 ? <Badge tone="warn">{compact(r.suspicious)}</Badge> : <span className="text-ink-3">-</span>}</Td>
                      <Td className="text-ink-2">{timeAgo(r.lastSeen)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="px-5 py-3 text-xs text-ink-3">Older SDK versions do not report the framework package, so their events show as JavaScript. Several versions of one package in use at once is normal while a rollout is going on.</p>
          </>
        )}
      </Card>
    </div>
  );
}
