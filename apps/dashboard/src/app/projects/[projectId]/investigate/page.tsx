'use client';

import type { GraphNode, GraphResponse, RingsResponse } from '@trace-id/signals/api';
import { ArrowRight, Network, Search, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { GraphView } from '@/components/graph';
import { KV, Score, StatStrip, When } from '@/components/domain';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Input, PageHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

type SeedType = 'visitor' | 'account' | 'ip';

function entityHref(base: string, n: GraphNode): string {
  if (n.type === 'visitor') return `${base}/visitors/${n.label}`;
  if (n.type === 'account') return `${base}/accounts/${encodeURIComponent(n.label)}`;
  return `${base}/events?ip=${encodeURIComponent(n.label)}`;
}

function Explorer({ seed, onSeed }: { seed: { type: SeedType; id: string } | null; onSeed: (s: { type: SeedType; id: string }) => void }) {
  const { project } = useProject();
  const base = `/projects/${project.id}`;
  const [type, setType] = useState<SeedType>(seed?.type ?? 'account');
  const [id, setId] = useState(seed?.id ?? '');
  const [days, setDays] = useState(30);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (!seed) return;
    setType(seed.type);
    setId(seed.id);
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    api<GraphResponse>(`/v1/projects/${project.id}/graph?type=${seed.type}&id=${encodeURIComponent(seed.id)}&days=${days}`)
      .then((g) => !cancelled && setGraph(g))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [seed, days, project.id]);

  const counts = graph
    ? { visitor: graph.nodes.filter((n) => n.type === 'visitor').length, account: graph.nodes.filter((n) => n.type === 'account').length, ip: graph.nodes.filter((n) => n.type === 'ip').length }
    : null;

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-2">Start from</span>
          <Segmented value={type} onChange={setType} options={[{ value: 'account', label: 'Account' }, { value: 'visitor', label: 'Device' }, { value: 'ip', label: 'IP address' }]} />
        </div>
        <form
          className="flex min-w-64 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (id.trim()) onSeed({ type, id: id.trim() });
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input className="pl-9 font-mono text-xs" placeholder={type === 'account' ? 'user_1042' : type === 'visitor' ? 'Visitor id (20 characters)' : '203.0.113.7'} value={id} onChange={(e) => setId(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" disabled={!id.trim()}>Explore</Button>
        </form>
        <Select aria-label="Window" className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </Card>
      <ErrorBanner message={error} />
      {!seed ? (
        <Card><EmptyState icon={<Network className="size-5" />} title="Map how identities connect" description="Enter an account, device or IP, or open a ring, to see every device, account and IP connected to it within two hops." /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {loading && !graph ? <Skeleton className="h-[560px]" /> : graph && graph.nodes.length > 0 ? (
              <GraphView graph={graph} selected={selected?.id ?? null} onSelect={setSelected} className="h-[min(70vh,560px)]" />
            ) : (
              <Card><EmptyState title="Nothing connected" description="No events were found for that id in this window." /></Card>
            )}
            {graph?.truncated && <p className="mt-2 text-xs text-ink-3">Large neighbourhood: showing the most active 160 nodes.</p>}
          </div>
          <div className="grid content-start gap-4">
            {counts && (
              <Card className="p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {([['Devices', counts.visitor], ['Accounts', counts.account], ['IPs', counts.ip]] as const).map(([l, n]) => (
                    <div key={l}><div className="tnum text-xl font-semibold">{n}</div><div className="text-[11px] text-ink-3">{l}</div></div>
                  ))}
                </div>
              </Card>
            )}
            <Card>
              <CardHeader title={selected ? 'Selected' : 'Details'} description={selected ? undefined : 'Click a node to inspect it'} />
              {selected && (
                <div className="px-5 pb-5">
                  <div className="mb-2 flex items-center gap-2"><Badge tone="neutral" className="capitalize">{selected.type === 'visitor' ? 'device' : selected.type}</Badge><Score value={selected.score} /></div>
                  <p className="break-all font-mono text-xs text-ink">{selected.label}</p>
                  <dl className="mt-2"><KV label="Events">{num(selected.events)}</KV><KV label="Connections">{graph?.edges.filter((e) => e.source === selected.id || e.target === selected.id).length ?? 0}</KV></dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => onSeed({ type: selected.type, id: selected.label })}>Centre here</Button>
                    <Button asChild size="sm" variant="outline"><Link href={entityHref(base, selected)}>Open <ArrowRight className="size-3.5" /></Link></Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Rings({ onOpen }: { onOpen: (s: { type: SeedType; id: string }) => void }) {
  const { project } = useProject();
  const [days, setDays] = useState(30);
  const [min, setMin] = useState(3);
  const rings = useApi<RingsResponse>(`/v1/projects/${project.id}/rings?days=${days}&minVisitors=${min}`);
  const d = rings.data;
  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <p className="mr-auto px-2 text-[13px] text-ink-2">Groups of devices tied together by a shared IP or account. Sorted by risk.</p>
        <Select aria-label="Window" className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
        <Select aria-label="Minimum size" className="w-40" value={min} onChange={(e) => setMin(Number(e.target.value))}>
          <option value={2}>2+ devices</option>
          <option value={3}>3+ devices</option>
          <option value={5}>5+ devices</option>
          <option value={10}>10+ devices</option>
        </Select>
      </Card>
      <ErrorBanner message={rings.error} />
      {d && d.rings.length > 0 && (
        <StatStrip
          items={[
            { label: 'Rings found', value: d.rings.length, hint: `${min}+ devices each` },
            { label: 'Devices in rings', value: d.rings.reduce((n, r) => n + r.size, 0), hint: 'Tied by shared IPs or accounts' },
            { label: 'Accounts involved', value: d.rings.reduce((n, r) => n + r.accounts, 0), hint: 'Distinct linked ids' },
            { label: 'Highest risk', value: Math.max(...d.rings.map((r) => r.risk)), tone: 'bad', hint: 'Out of 100' },
          ]}
        />
      )}
      {!d ? <Skeleton className="h-64" /> : d.rings.length === 0 ? (
        <Card><EmptyState icon={<ShieldAlert className="size-5" />} title="No rings found" description="No group of devices shares an IP or account in this window." /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {d.rings.map((r) => {
            const tone = r.risk >= 70 ? 'bad' : r.risk >= 40 ? 'warn' : 'ok';
            return (
              <Card key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn('grid size-9 place-items-center rounded-xl text-[13px] font-semibold', tone === 'bad' ? 'bg-bad-soft text-bad' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>{r.risk}</span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{r.size} devices · {r.accounts} account{r.accounts === 1 ? '' : 's'}</p>
                        <p className="text-xs text-ink-3">{r.ips} IP{r.ips === 1 ? '' : 's'} · {num(r.events)} events · last seen <When iso={r.lastSeenAt} /></p>
                      </div>
                    </div>
                  </div>
                  <Badge tone={tone}>{r.risk >= 70 ? 'Likely ring' : r.risk >= 40 ? 'Suspicious' : 'Shared'}</Badge>
                </div>
                <div className="mt-4 grid gap-2 text-[13px]">
                  {r.sharedIps.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="w-24 shrink-0 text-xs text-ink-3">Shared IPs</span>{r.sharedIps.map((ip) => <button key={ip} onClick={() => onOpen({ type: 'ip', id: ip })} className="cursor-pointer rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:text-signal">{ip}</button>)}</div>}
                  {r.sharedAccounts.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="w-24 shrink-0 text-xs text-ink-3">Shared accounts</span>{r.sharedAccounts.map((a) => <button key={a} onClick={() => onOpen({ type: 'account', id: a })} className="cursor-pointer rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:text-signal">{a}</button>)}</div>}
                  <div className="flex items-center gap-2"><span className="w-24 shrink-0 text-xs text-ink-3">Peak score</span><Score value={r.maxScore} /><span className="text-xs text-ink-3">average {r.avgPeakScore}</span></div>
                </div>
                <Button className="mt-4" variant="outline" size="sm" onClick={() => onOpen({ type: 'visitor', id: r.sampleVisitors[0]! })}><Network className="size-3.5" /> Open in graph</Button>
              </Card>
            );
          })}
        </div>
      )}
      {d?.truncated && <p className="text-xs text-ink-3">This window holds more activity than could be read at once; shorter windows are exact.</p>}
    </div>
  );
}

function InvestigateInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { project } = useProject();
  const base = `/projects/${project.id}/investigate`;
  const type = params.get('type') as SeedType | null;
  const id = params.get('id');
  const seed = type && id && ['visitor', 'account', 'ip'].includes(type) ? { type, id } : null;
  const tab = seed ? 'graph' : (params.get('tab') ?? 'rings');

  function setSeed(s: { type: SeedType; id: string }) {
    router.replace(`${base}?tab=graph&type=${s.type}&id=${encodeURIComponent(s.id)}`, { scroll: false });
  }

  return (
    <>
      <PageHeader title="Investigate" description="Follow the connections between devices, accounts and IP addresses to find coordinated fraud that no single event shows." />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${base}?tab=${v}${v === 'graph' && seed ? `&type=${seed.type}&id=${encodeURIComponent(seed.id)}` : ''}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="rings">Rings</TabsTrigger>
          <TabsTrigger value="graph">Graph explorer</TabsTrigger>
        </TabsList>
        <TabsContent value="rings"><Rings onOpen={setSeed} /></TabsContent>
        <TabsContent value="graph"><Explorer seed={seed} onSeed={setSeed} /></TabsContent>
      </Tabs>
    </>
  );
}

export default function InvestigatePage() {
  return (
    <Suspense>
      <InvestigateInner />
    </Suspense>
  );
}
