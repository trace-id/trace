'use client';

import type { LinkedIdListItem, LinkedIdListResponse } from '@trace-id/signals/api';
import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Score, StatStrip, When } from '@/components/domain';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Segmented, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { compact, num } from '@/lib/format';
import type { AnalyticsResponse } from '@trace-id/signals/api';
import { useApi } from '@/lib/use-api';
import { useProject } from '@/lib/project-context';

type Sort = 'recent' | 'events' | 'risk' | 'devices';

function AccountsInner() {
  const { project } = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/projects/${project.id}`;
  const [sort, setSort] = useState<Sort>('devices');
  const stats = useApi<AnalyticsResponse>(`/v1/projects/${project.id}/analytics?days=30`);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q.trim());
  const [items, setItems] = useState<LinkedIdListItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const qs = `sort=${sort}&limit=25${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    api<LinkedIdListResponse>(`/v1/projects/${project.id}/accounts?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setItems(r.accounts);
        setNext(r.nextCursor);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [project.id, qs]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const r = await api<LinkedIdListResponse>(`/v1/projects/${project.id}/accounts?${qs}&cursor=${next}`);
      setItems((i) => [...(i ?? []), ...r.accounts]);
      setNext(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  }

  return (
    <>
      <PageHeader title="Accounts" description="Your own account ids (the linkedId you pass to identify), with the devices behind each. Many devices on one account, or many accounts on one device, is the classic sign of sharing or farming." />
      <div className="mb-5">
        <StatStrip
          items={[
            { label: 'Accounts (30 days)', value: stats.data ? compact(stats.data.totals.uniqueLinkedIds) : '-', hint: 'Distinct linked ids' },
            { label: 'Linked events', value: stats.data ? compact(stats.data.topLinkedIds.reduce((n, r) => n + r.events, 0)) : '-', hint: 'From the busiest ten accounts' },
            { label: 'Most devices on one', value: stats.data?.topLinkedIds[0] ? stats.data.topLinkedIds[0].visitors : '-', tone: (stats.data?.topLinkedIds[0]?.visitors ?? 0) >= 3 ? 'warn' : undefined, hint: stats.data?.topLinkedIds[0]?.key },
            { label: 'Risky accounts', value: stats.data ? stats.data.topLinkedIds.filter((r) => r.suspicious > 0).length : '-', hint: 'Among the busiest ten' },
          ]}
        />
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input className="pl-9" placeholder="Account id starts with…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented value={sort} onChange={setSort} options={[{ value: 'devices', label: 'Most devices' }, { value: 'recent', label: 'Recent' }, { value: 'events', label: 'Most active' }, { value: 'risk', label: 'Riskiest' }]} />
      </Card>
      <ErrorBanner message={error} />
      <Card className="overflow-hidden">
        {!items ? (
          <div className="grid gap-3 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState title="No accounts yet" description="Pass your user id as linkedId when you call identify, for example at sign-in and sign-up." />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Peak risk</Th><Th>Account</Th><Th className="text-right">Devices</Th><Th className="text-right">Browsers</Th><Th className="text-right">Events</Th><Th>First seen</Th><Th>Last seen</Th></tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <Tr key={a.linkedId} interactive onClick={() => router.push(`${base}/accounts/${encodeURIComponent(a.linkedId)}`)}>
                    <Td><Score value={a.maxScore} /></Td>
                    <Td><span className="font-mono text-xs">{a.linkedId}</span></Td>
                    <Td className="tnum text-right">{a.devices >= 3 ? <Badge tone="warn">{a.devices}</Badge> : a.devices}</Td>
                    <Td className="tnum text-right">{a.visitors}</Td>
                    <Td className="tnum text-right">{num(a.events)}</Td>
                    <Td><When iso={a.firstSeenAt} /></Td>
                    <Td><When iso={a.lastSeenAt} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-3">
              <span>{items.length} accounts loaded</span>
              {next && <Button variant="outline" size="sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Load more'}</Button>}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsInner />
    </Suspense>
  );
}
