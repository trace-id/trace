'use client';

import type { EventSearchItem } from '@trace-id/signals/api';
import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { AreaChart, BarList, type Series } from '@/components/charts/charts';
import { Device, EntityLink, MatchBadge, Place, Score, SignalChips, When } from '@/components/domain';
import { Card, CardHeader, EmptyState, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { countryName } from '@/lib/country';
import { BrowserLogo, DeviceCell, Flag, OsLogo } from '@/components/logos';
import { shortDay, shortId } from '@/lib/format';
import { signalTitle } from '@/lib/signals';
import { summarise } from '@/lib/use-events';

const SERIES: Series[] = [
  { key: 'score', name: 'Peak score', color: 'var(--bad)', area: true },
  { key: 'events', name: 'Events', color: 'var(--signal)' },
];

/** Charts and breakdowns for one entity (a visitor or an account), built from its events. */
export function EntityInsights({ events, basePath, extra }: { events: EventSearchItem[] | null; basePath: string; extra?: ReactNode }) {
  const router = useRouter();
  const s = useMemo(() => (events ? summarise(events) : null), [events]);
  const { chart, hourly } = useMemo(() => {
    if (!events || events.length === 0) return { chart: [], hourly: false };
    const times = events.map((e) => new Date(e.createdAt).getTime());
    const span = Math.max(...times) - Math.min(...times);
    const hourly = span < 3 * 86_400_000;
    const step = hourly ? 3_600_000 : 86_400_000;
    const key = (t: number) => new Date(t).toISOString().slice(0, hourly ? 13 : 10);
    const byKey = new Map<string, { events: number; score: number }>();
    for (const e of events) {
      const k = e.createdAt.slice(0, hourly ? 13 : 10);
      const cur = byKey.get(k) ?? { events: 0, score: 0 };
      cur.events += 1;
      cur.score = Math.max(cur.score, e.suspectScore);
      byKey.set(k, cur);
    }
    let start = Math.floor(Math.min(...times) / step) * step;
    const end = Math.floor(Math.max(...times) / step) * step;
    if (start === end) start -= step; // a line needs two points
    const out: { label: string; values: { events: number; score: number } }[] = [];
    for (let t = start; t <= end; t += step) {
      const k = key(t);
      out.push({ label: k, values: byKey.get(k) ?? { events: 0, score: 0 } });
      if (out.length > 400) break;
    }
    return { chart: out, hourly };
  }, [events]);

  if (!events || !s) return <Skeleton className="h-64" />;
  if (events.length === 0) return <Card><EmptyState title="No events" description="Nothing was recorded for this one yet." /></Card>;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Activity" description={hourly ? 'Events per hour and the highest score each hour' : 'Events per day and the highest score each day'} />
          <div className="px-3 pb-4"><AreaChart data={chart} series={SERIES} xLabel={shortDay} height={220} /></div>
        </Card>
        <Card>
          <CardHeader title="Signals" description="Detected across these events" />
          <BarList color="var(--warn)" rows={s.signals.slice(0, 8).map(([id, n]) => ({ key: id, label: signalTitle(id), value: n }))} empty="No signals fired" onSelect={(id) => router.push(`${basePath}/events?signal=${id}`)} />
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader title="Locations" />
          <BarList rows={s.countries.slice(0, 6).map(([c, n]) => ({ key: c, label: <span className="flex items-center gap-2"><Flag code={c} /> {countryName(c)}</span>, value: n }))} />
        </Card>
        <Card>
          <CardHeader title="IP addresses" />
          <BarList color="var(--info)" rows={s.ips.slice(0, 6).map(([ip, n]) => ({ key: ip, label: <span className="font-mono text-xs">{ip}</span>, value: n }))} />
        </Card>
        <Card>
          <CardHeader title="Devices" />
          <BarList color="var(--info)" rows={s.devices.slice(0, 6).map(([d, n]) => { const [b = '', o = ''] = d.split(' · '); return { key: d, label: <DeviceCell browser={b} os={o} />, value: n }; })} />
        </Card>
      </div>
      {extra}
    </div>
  );
}

/** Compact event table used on detail pages. */
export function EventsTable({ events, basePath, showVisitor = true, showAccount = true }: { events: EventSearchItem[]; basePath: string; showVisitor?: boolean; showAccount?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Score</Th>
          <Th>Time</Th>
          {showVisitor && <Th>Visitor</Th>}
          {showAccount && <Th>Account</Th>}
          <Th>Location</Th>
          <Th>Device</Th>
          <Th>Signals</Th>
          <Th>Identified</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <Tr key={e.eventId} interactive onClick={() => router.push(`${basePath}/events/${e.eventId}`)}>
            <Td><Score value={e.suspectScore} /></Td>
            <Td><When iso={e.createdAt} /></Td>
            {showVisitor && <Td><EntityLink href={`${basePath}/visitors/${e.visitorId}`} mono>{shortId(e.visitorId, 10)}</EntityLink></Td>}
            {showAccount && <Td>{e.linkedId ? <EntityLink href={`${basePath}/accounts/${encodeURIComponent(e.linkedId)}`} mono>{shortId(e.linkedId, 14)}</EntityLink> : <span className="text-ink-3">-</span>}</Td>}
            <Td><div className="grid"><Place code={e.country} />{e.ip && <span className="font-mono text-[11px] text-ink-3">{e.ip}</span>}</div></Td>
            <Td><Device browser={e.browser} os={e.os} /></Td>
            <Td><SignalChips ids={e.detected ?? []} max={2} /></Td>
            <Td><MatchBadge kind={e.matchKind} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Vertical timeline of events, newest first; the current one (if any) is highlighted. */
export function Timeline({ events, basePath, currentId, limit }: { events: EventSearchItem[]; basePath: string; currentId?: string; limit?: number }) {
  const router = useRouter();
  const list = limit ? events.slice(0, limit) : events;
  return (
    <ol className="relative px-5 pb-4">
      <span className="absolute bottom-6 left-[29px] top-2 w-px bg-line" aria-hidden />
      {list.map((e) => {
        const tone = e.suspectScore >= 70 ? 'bg-bad' : e.suspectScore >= 30 ? 'bg-warn' : 'bg-ok';
        const current = e.eventId === currentId;
        return (
          <li key={e.eventId}>
            <button type="button" onClick={() => !current && router.push(`${basePath}/events/${e.eventId}`)} className={`relative flex w-full cursor-pointer items-start gap-3.5 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-2 ${current ? 'bg-signal-soft' : ''}`}>
              <span className={`relative z-[1] mt-1 size-3 shrink-0 rounded-full ring-4 ring-surface ${tone}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium text-ink">Score {e.suspectScore}{current && <span className="ml-2 text-xs font-normal text-signal-ink">this event</span>}</span>
                  <When iso={e.createdAt} />
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <Place code={e.country} />
                  <span className="inline-flex items-center gap-1.5"><BrowserLogo name={e.browser ?? ''} size={14} />{[e.browser, e.os].filter(Boolean).join(' · ')}{e.os && <OsLogo name={e.os} size={12} />}</span>
                </span>
                {(e.detected?.length ?? 0) > 0 && <span className="mt-1.5 block"><SignalChips ids={e.detected ?? []} max={3} /></span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
