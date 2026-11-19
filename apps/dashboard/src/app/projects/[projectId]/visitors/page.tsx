'use client';

import type { VisitorListItem, VisitorListResponse } from '@trace-id/signals/api';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Device, Place, Score, StatStrip, When } from '@/components/domain';
import { Button, Card, EmptyState, ErrorBanner, Id, Input, PageHeader, Segmented, Select, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { compact, num, pct } from '@/lib/format';
import type { AnalyticsResponse } from '@trace-id/signals/api';
import { useApi } from '@/lib/use-api';
import { useProject } from '@/lib/project-context';

type Sort = 'recent' | 'events' | 'risk' | 'new';

export default function VisitorsPage() {
  const { project } = useProject();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const [sort, setSort] = useState<Sort>('recent');
  const stats = useApi<AnalyticsResponse>(`/v1/projects/${project.id}/analytics?days=30`);
  const [risk, setRisk] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<VisitorListItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const qs = `sort=${sort}&limit=25${risk ? `&minScore=${risk}` : ''}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    api<VisitorListResponse>(`/v1/projects/${project.id}/visitors?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setItems(r.visitors);
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
      const r = await api<VisitorListResponse>(`/v1/projects/${project.id}/visitors?${qs}&cursor=${next}`);
      setItems((i) => [...(i ?? []), ...r.visitors]);
      setNext(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  }

  return (
    <>
      <PageHeader title="Visitors" description="Every device Trace has recognised in this project." />
      <div className="mb-5">
        <StatStrip
          items={[
            { label: 'Devices (30 days)', value: stats.data ? compact(stats.data.totals.visitors) : '-', hint: 'Distinct visitors' },
            { label: 'New devices', value: stats.data ? compact(stats.data.totals.newVisitors) : '-', hint: 'First seen in the window' },
            { label: 'Returning', value: stats.data && stats.data.totals.visitors ? pct(stats.data.totals.returningVisitors / stats.data.totals.visitors, 0) : '-', hint: 'Seen before' },
            { label: 'Avg events per device', value: stats.data && stats.data.totals.visitors ? (stats.data.totals.events / stats.data.totals.visitors).toFixed(1) : '-', hint: 'Over the window' },
          ]}
        />
      </div>
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input className="pl-9" placeholder="Visitor or device id starts with…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'new', label: 'Newest' },
            { value: 'events', label: 'Most active' },
            { value: 'risk', label: 'Riskiest' },
          ]}
        />
        <Select aria-label="Risk" className="w-44" value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">Any peak risk</option>
          <option value="30">Peak 30+</option>
          <option value="70">Peak 70+</option>
        </Select>
      </Card>
      <ErrorBanner message={error} />
      <Card className="overflow-hidden">
        {!items ? (
          <div className="grid gap-3 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState title="No visitors found" description="Try a different search or risk filter." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Peak risk</Th>
                  <Th>Visitor</Th>
                  <Th>Device</Th>
                  <Th>Last location</Th>
                  <Th className="text-right">Events</Th>
                  <Th className="text-right">Accounts</Th>
                  <Th>First seen</Th>
                  <Th>Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <Tr key={v.visitorId} interactive onClick={() => router.push(`${base}/visitors/${v.visitorId}`)}>
                    <Td><Score value={v.maxScore} /></Td>
                    <Td><Id value={v.visitorId} short={12} /></Td>
                    <Td><Device browser={v.browser} os={v.os} deviceType={v.deviceType} /></Td>
                    <Td><div className="grid"><Place code={v.lastCountry} />{v.lastIp && <span className="font-mono text-[11px] text-ink-3">{v.lastIp}</span>}</div></Td>
                    <Td className="tnum text-right">{num(v.eventCount)}</Td>
                    <Td className="tnum text-right">{v.linkedIds}</Td>
                    <Td><When iso={v.firstSeenAt} /></Td>
                    <Td><When iso={v.lastSeenAt} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-3">
              <span>{items.length} visitors loaded</span>
              {next && <Button variant="outline" size="sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Load more'}</Button>}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
