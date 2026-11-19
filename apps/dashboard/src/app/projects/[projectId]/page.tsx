'use client';

import type { AnalyticsResponse, CountRow, EventSearchResponse } from '@trace-id/signals/api';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AreaChart, BarList, Donut, Heatmap, Histogram, Legend, Sparkline, type Series } from '@/components/charts/charts';
import { CountUp, Device, EntityLink, Place, Score, SignalChips, When } from '@/components/domain';
import { LiveFeed } from '@/components/live-feed';
import { BrowserLabel, DeviceTypeIcon, Flag, OsLabel, TypeLabel } from '@/components/logos';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, PageHeader, Segmented, Skeleton, Table, Td, Tr } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { countryName } from '@/lib/country';
import { compact, delta, num, pct, shortDay } from '@/lib/format';
import { RANGES, useProject } from '@/lib/project-context';
import { signalTitle } from '@/lib/signals';
import { useApi } from '@/lib/use-api';

const SERIES: Series[] = [
  { key: 'events', name: 'Events', color: 'var(--signal)', area: true },
  { key: 'visitors', name: 'Visitors', color: 'var(--info)' },
  { key: 'suspicious', name: 'Suspicious', color: 'var(--bad)' },
];

const SCORE_LABELS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90+'];
const scoreColor = (i: number) => (i >= 7 ? 'var(--bad)' : i >= 3 ? 'var(--warn)' : 'var(--ok)');

function rows(list: CountRow[], label: (k: string) => React.ReactNode) {
  return list.map((r) => ({
    key: r.key,
    label: label(r.key),
    value: r.events,
    sub: r.suspicious > 0 ? <span className="text-bad">{pct(r.suspicious / r.events, 0)} risky</span> : undefined,
  }));
}

function Delta({ change, invert }: { change: number | null | undefined; invert?: boolean }) {
  if (change === undefined) return null;
  if (change === null) return <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-3">new</span>;
  const up = change > 0.0005;
  const down = change < -0.0005;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const I = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', good ? 'bg-ok-soft text-ok' : bad ? 'bg-bad-soft text-bad' : 'bg-surface-3 text-ink-3')}>
      <I className="size-3" />
      {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
    </span>
  );
}

function Kpi({ label, value, change, invert, hint, spark, sparkColor, loading, count }: { label: string; value: string; change?: number | null; invert?: boolean; hint?: string; spark?: number[]; sparkColor?: string; loading?: boolean; count?: { to: number; fmt: (n: number) => string } }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      {loading ? (
        <div className="skeleton mt-1 h-8 w-20" />
      ) : (
        <div className="flex items-center gap-2">
          <span className="tnum text-[26px] font-semibold leading-8 tracking-tight text-ink">{count ? <CountUp value={count.to} format={count.fmt} /> : value}</span>
          <Delta change={change} invert={invert} />
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        <span className="truncate text-xs text-ink-3">{hint}</span>
        {spark && <Sparkline values={spark} color={sparkColor} width={72} height={24} />}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { project, range, setRange } = useProject();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const a = useApi<AnalyticsResponse>(`/v1/projects/${project.id}/analytics?days=${range}`, { intervalMs: 60_000 });
  const risky = useApi<EventSearchResponse>(`/v1/projects/${project.id}/events?minScore=70&limit=7`, { intervalMs: 60_000 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const d = a.data;
  const total = d?.totals;
  const prev = d?.previous;
  const hasData = (total?.events ?? 0) > 0;
  const shown = SERIES.filter((s) => !hidden.has(s.key));
  const rangeLabel = RANGES.find((r) => r.days === range)?.label ?? `${range}d`;

  const chart = useMemo(() => (d?.series ?? []).map((p) => ({ label: p.t, values: { events: p.events, visitors: p.visitors, suspicious: p.suspicious } })), [d]);
  const sp = useMemo(
    () => ({
      visitors: d?.series.map((p) => p.visitors) ?? [],
      fresh: d?.series.map((p) => p.newVisitors) ?? [],
    }),
    [d],
  );

  const bands = useMemo(() => {
    if (!d) return { low: 0, mid: 0, high: 0, sum: 0 };
    const h = d.scoreHistogram;
    const low = h.slice(0, 3).reduce((x, y) => x + y, 0);
    const mid = h.slice(3, 7).reduce((x, y) => x + y, 0);
    const high = h.slice(7).reduce((x, y) => x + y, 0);
    return { low, mid, high, sum: low + mid + high };
  }, [d]);

  const attention = useMemo(() => {
    if (!d) return [];
    const items: { key: string; kind: string; title: string; detail: string; href: string }[] = [];
    for (const ip of d.topIps.filter((r) => r.visitors >= 4).slice(0, 3)) items.push({ key: `ip-${ip.key}`, kind: 'Shared IP', title: ip.key, detail: `${ip.visitors} devices · ${ip.events} events`, href: `${base}/investigate?tab=graph&type=ip&id=${encodeURIComponent(ip.key)}` });
    for (const acc of d.topLinkedIds.filter((r) => r.visitors >= 3).slice(0, 3)) items.push({ key: `acc-${acc.key}`, kind: 'Shared account', title: acc.key, detail: `${acc.visitors} devices · ${acc.events} events`, href: `${base}/investigate?tab=graph&type=account&id=${encodeURIComponent(acc.key)}` });
    return items;
  }, [d, base]);

  const suspShare = total && total.events ? total.suspicious / total.events : 0;
  const returning = total && total.visitors ? total.returningVisitors / total.visitors : 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={d ? `${rangeLabel} window · ${num(d.totals.events)} events from ${num(d.totals.visitors)} devices` : 'How traffic and risk are moving across your project.'}
        actions={
          <>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => { a.reload(); risky.reload(); }}><RefreshCw className={cn('size-3.5', a.loading && 'animate-spin')} /></Button>
            <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.days, label: r.label }))} />
          </>
        }
      />
      <ErrorBanner message={a.error} />

      {d && !hasData ? (
        <Card>
          <EmptyState title="No events in this window" description="Once your site calls identify, activity shows up here. Try a longer range, or follow the setup guide to send your first event." action={<Button asChild variant="signal"><Link href={`${base}/setup`}>Open setup guide</Link></Button>} />
        </Card>
      ) : (
        <div className="grid gap-5">
          {/* Hero: traffic and risk posture */}
          <Card className="overflow-hidden">
            <div className="grid xl:grid-cols-[1fr_380px]">
              <div className="min-w-0 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-ink-3">Events · {rangeLabel}</p>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="tnum text-[40px] font-semibold leading-[44px] tracking-tight text-ink">{d ? <CountUp value={total!.events} format={(n) => num(Math.round(n))} /> : <span className="skeleton inline-block h-10 w-32 align-middle" />}</span>
                      {prev && total && <Delta change={delta(total.events, prev.events)} />}
                    </div>
                    <p className="mt-1 text-xs text-ink-3">vs the previous {rangeLabel}</p>
                  </div>
                  <Legend series={SERIES} hidden={hidden} onToggle={(k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else if (n.size < SERIES.length - 1) n.add(k); return n; })} />
                </div>
                <div className="-ml-2 mt-4">{d ? <AreaChart data={chart} series={shown} xLabel={shortDay} height={300} /> : <Skeleton className="h-[300px]" />}</div>
              </div>
              <aside className="border-t border-line bg-surface-2/60 p-6 xl:border-l xl:border-t-0">
                <p className="text-xs font-medium text-ink-3">Risk posture</p>
                <div className="mt-3 flex items-center gap-5">
                  <Donut
                    size={112}
                    thickness={12}
                    slices={[
                      { key: 'low', label: 'Low', value: bands.low, color: 'var(--ok)' },
                      { key: 'mid', label: 'Medium', value: bands.mid, color: 'var(--warn)' },
                      { key: 'high', label: 'High', value: bands.high, color: 'var(--bad)' },
                    ]}
                    center={<div><div className="tnum text-xl font-semibold leading-none">{d ? pct(suspShare, 0) : '-'}</div><div className="mt-0.5 text-[10px] text-ink-3">risky</div></div>}
                    hideLegend
                  />
                  <ul className="grid flex-1 gap-1.5 text-[13px]">
                    {[['Low', bands.low, 'var(--ok)'], ['Medium', bands.mid, 'var(--warn)'], ['High', bands.high, 'var(--bad)']].map(([l, v, c]) => (
                      <li key={l as string} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-ink-2"><span className="size-2 rounded-full" style={{ background: c as string }} />{l as string}</span>
                        <span className="tnum font-medium">{bands.sum ? pct((v as number) / bands.sum, 0) : '-'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
                  {[
                    ['Suspicious events', total ? num(total.suspicious) : '-', prev && total ? delta(total.suspicious, prev.suspicious) : undefined],
                    ['Automated or masked', total ? num(total.automated) : '-', prev && total ? delta(total.automated, prev.automated) : undefined],
                    ['Average score', total ? total.avgScore.toFixed(1) : '-', prev && total ? delta(total.avgScore, prev.avgScore) : undefined],
                  ].map(([l, v, ch]) => (
                    <div key={l as string} className="flex items-center justify-between bg-surface px-3.5 py-2.5">
                      <dt className="text-ink-2">{l as string}</dt>
                      <dd className="flex items-center gap-2"><span className="tnum font-semibold">{v as string}</span><Delta change={ch as number | null | undefined} invert /></dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-ink-3">Risky means a suspect score of {d?.suspiciousThreshold ?? 70} or higher.</p>
              </aside>
            </div>
          </Card>

          {/* KPI strip */}
          <Card className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-6 [&>*]:sm:border-l [&>*]:sm:border-line [&>*:first-child]:border-l-0">
            <Kpi label="Unique visitors" value={compact(total?.visitors ?? 0)} count={{ to: total?.visitors ?? 0, fmt: (n) => compact(Math.round(n)) }} change={prev && total ? delta(total.visitors, prev.visitors) : undefined} spark={sp.visitors} sparkColor="var(--info)" loading={!d} hint="Distinct devices" />
            <Kpi label="New devices" value={compact(total?.newVisitors ?? 0)} change={prev && total ? delta(total.newVisitors, prev.newVisitors) : undefined} spark={sp.fresh} loading={!d} hint="First seen in window" />
            <Kpi label="Returning" value={pct(returning, 0)} loading={!d} hint="Share of devices seen before" />
            <Kpi label="Unique IPs" value={compact(total?.uniqueIps ?? 0)} change={prev && total ? delta(total.uniqueIps, prev.uniqueIps) : undefined} loading={!d} hint="Distinct addresses" />
            <Kpi label="Accounts seen" value={compact(total?.uniqueLinkedIds ?? 0)} change={prev && total ? delta(total.uniqueLinkedIds, prev.uniqueLinkedIds) : undefined} loading={!d} hint="Distinct linked ids" />
            <Kpi label="Match confidence" value={total ? pct(total.avgConfidence) : '0%'} loading={!d} hint="Returning visitors" />
          </Card>

          {/* Device mix */}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {(['Desktop', 'Mobile', 'Tablet', 'Bot'] as const).map((t) => {
              const row = d?.deviceTypes.find((r) => r.key === t);
              const share = d && total && total.events ? (row?.events ?? 0) / total.events : 0;
              return (
                <Card key={t} className="flex items-center gap-4 p-5">
                  <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', t === 'Bot' ? 'bg-bad-soft' : 'bg-surface-3')}><DeviceTypeIcon type={t} size={22} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-3">{t === 'Bot' ? 'Bots and headless' : t}</p>
                    <p className="tnum mt-0.5 text-xl font-semibold leading-6 tracking-tight">{d ? pct(share, share < 0.1 ? 1 : 0) : '-'}</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', t === 'Bot' ? 'bg-bad' : 'bg-signal')} style={{ width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }} /></div>
                  </div>
                  <span className="text-right text-xs text-ink-3">{row ? num(row.events) : 0}<br />events</span>
                </Card>
              );
            })}
          </div>

          {/* Live, attention, signals */}
          <div className="grid items-stretch gap-5 xl:grid-cols-3">
            <LiveFeed projectId={project.id} base={base} />
            <Card>
              <CardHeader title="Needs a look" description="Shared infrastructure that often means farmed identities" action={<Link href={`${base}/investigate`} className="text-xs font-medium text-signal hover:underline">Rings</Link>} />
              <ul className="grid gap-1 px-2 pb-3">
                {!d ? <li><Skeleton className="mx-3 h-40" /></li> : attention.length === 0 ? (
                  <li className="px-3 py-10 text-center text-[13px] text-ink-3">Nothing unusual in this window.</li>
                ) : attention.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-warn-soft text-warn"><TriangleAlert className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12.5px] text-ink">{item.title}</span>
                        <span className="block text-xs text-ink-3">{item.kind} · {item.detail}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Signals fired" description="Events where each signal was detected" action={<Link href={`${base}/signals`} className="text-xs font-medium text-signal hover:underline">All signals</Link>} />
              {d ? <BarList color="var(--warn)" rows={d.signals.slice(0, 10).map((s) => ({ key: s.id, label: signalTitle(s.id), value: s.events, sub: `${num(s.visitors)} devices` }))} onSelect={(id) => router.push(`${base}/events?signal=${id}`)} empty="No signals fired" /> : <Skeleton className="mx-5 mb-5 h-40" />}
            </Card>
          </div>

          {/* Geo and devices */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <Tabs defaultValue="countries">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
                  <h3 className="text-sm font-semibold tracking-tight">Where traffic comes from</h3>
                  <TabsList className="border-0">
                    <TabsTrigger value="countries">Countries</TabsTrigger>
                    <TabsTrigger value="asns">Networks</TabsTrigger>
                    <TabsTrigger value="ips">IPs</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="countries" className="mt-2"><BarList rows={rows(d?.countries.slice(0, 8) ?? [], (k) => <span className="flex items-center gap-2"><Flag code={k} />{countryName(k)}</span>)} onSelect={(k) => router.push(`${base}/events?country=${k}`)} /></TabsContent>
                <TabsContent value="asns" className="mt-2"><BarList rows={rows(d?.asns.slice(0, 8) ?? [], (k) => `AS${k}`)} /></TabsContent>
                <TabsContent value="ips" className="mt-2"><BarList rows={(d?.topIps.slice(0, 8) ?? []).map((r) => ({ key: r.key, label: <span className="font-mono text-xs">{r.key}</span>, value: r.events, sub: `${r.visitors} device${r.visitors === 1 ? '' : 's'}` }))} onSelect={(k) => router.push(`${base}/events?ip=${encodeURIComponent(k)}`)} /></TabsContent>
              </Tabs>
            </Card>
            <Card>
              <Tabs defaultValue="browsers">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
                  <h3 className="text-sm font-semibold tracking-tight">Devices</h3>
                  <TabsList className="border-0">
                    <TabsTrigger value="browsers">Browsers</TabsTrigger>
                    <TabsTrigger value="os">OS</TabsTrigger>
                    <TabsTrigger value="types">Types</TabsTrigger>
                    <TabsTrigger value="sdks">SDKs</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="browsers" className="mt-2"><BarList color="var(--info)" rows={rows(d?.browsers ?? [], (k) => <BrowserLabel name={k} />)} /></TabsContent>
                <TabsContent value="os" className="mt-2"><BarList color="var(--info)" rows={rows(d?.os ?? [], (k) => <OsLabel name={k} />)} /></TabsContent>
                <TabsContent value="types" className="mt-2"><BarList color="var(--info)" rows={rows(d?.deviceTypes ?? [], (k) => <TypeLabel name={k} />)} /></TabsContent>
                <TabsContent value="sdks" className="mt-2"><BarList color="var(--ink-3)" rows={(d?.sdks ?? []).map((s) => ({ key: s.key, label: s.key, value: s.events }))} /></TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* Distribution */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Risk distribution" description="Events by suspect score" />
              <div className="px-5 pb-5">{d ? <Histogram values={d.scoreHistogram} labels={SCORE_LABELS} colorFor={scoreColor} height={170} /> : <Skeleton className="h-44" />}</div>
            </Card>
            <Card>
              <CardHeader title="Identification" description="How each event was recognised" />
              <div className="px-5 pb-5">
                {d ? (
                  <Donut
                    slices={[
                      { key: 'new', label: 'New device', value: d.matchKinds.new ?? 0, color: 'var(--signal)' },
                      { key: 'token', label: 'Returning', value: d.matchKinds.token ?? 0, color: 'var(--info)' },
                      { key: 'match', label: 'Signal match', value: d.matchKinds.match ?? 0, color: 'var(--warn)' },
                      { key: 'conflict', label: 'Conflict', value: d.matchKinds.conflict ?? 0, color: 'var(--bad)' },
                    ]}
                    size={140}
                    center={<div><div className="tnum text-lg font-semibold leading-none">{compact(total?.events ?? 0)}</div><div className="mt-0.5 text-[10px] text-ink-3">events</div></div>}
                  />
                ) : <Skeleton className="h-40" />}
              </div>
            </Card>
            <Card>
              <CardHeader title="Activity by hour" description="Events per weekday and hour (UTC)" />
              {d ? <Heatmap grid={d.heatmap} /> : <Skeleton className="mx-5 mb-5 h-40" />}
            </Card>
          </div>

          {/* High risk + accounts */}
          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader title="Recent high-risk events" description={`Scored ${d?.suspiciousThreshold ?? 70} or higher`} action={<Link href={`${base}/events?minScore=70`} className="text-xs font-medium text-signal hover:underline">View all</Link>} />
              {risky.data && risky.data.events.length === 0 ? (
                <p className="px-5 pb-6 text-[13px] text-ink-3">No high-risk events yet.</p>
              ) : (
                <Table>
                  <tbody>
                    {(risky.data?.events ?? []).map((e) => (
                      <Tr key={e.eventId} interactive onClick={() => router.push(`${base}/events/${e.eventId}`)}>
                        <Td className="w-20 pl-5"><Score value={e.suspectScore} compact /></Td>
                        <Td><SignalChips ids={e.detected ?? []} max={2} /></Td>
                        <Td className="hidden md:table-cell"><Place code={e.country} /></Td>
                        <Td className="hidden lg:table-cell"><Device browser={e.browser} os={e.os} /></Td>
                        <Td className="pr-5 text-right"><When iso={e.createdAt} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Busiest accounts" description="Linked ids by distinct devices" action={<Link href={`${base}/accounts`} className="text-xs font-medium text-signal hover:underline">All accounts</Link>} />
              <BarList color="var(--info)" rows={(d?.topLinkedIds ?? []).slice(0, 7).map((r) => ({ key: r.key, label: <EntityLink href={`${base}/accounts/${encodeURIComponent(r.key)}`} mono>{r.key}</EntityLink>, value: r.visitors, sub: <>{r.events} events{r.suspicious > 0 && <Badge tone="bad" className="ml-2">{r.suspicious} risky</Badge>}</> }))} empty="No linked ids yet. Pass linkedId when you call identify." />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
