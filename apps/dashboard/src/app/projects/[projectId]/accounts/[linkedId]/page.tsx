'use client';

import type { EventResponse, EventSearchItem } from '@trace-id/signals/api';
import { Activity, ArrowLeft, Cpu, Gauge, Globe2, History, LayoutGrid, Laptop, Network, ShieldAlert, Table2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CountryChip, Device, EntityLink, When } from '@/components/domain';
import { EntityInsights, EventsTable } from '@/components/entity';
import { DayTimeline, EntityHeader, KpiGrid, ScoreRing, VerdictCard, dailySeries } from '@/components/entity-page';
import { DeviceProfile, NetworkProfile } from '@/components/profiles';
import { Tabs, TabCount, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Segmented, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { countryName } from '@/lib/country';
import { scoreTone, timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';
import { summarise, useEvents } from '@/lib/use-events';
import { useTab } from '@/lib/use-tab';

const TABS = ['overview', 'devices', 'timeline', 'events', 'profile'] as const;
type View = 'all' | 'flagged' | 'clean';
const FLAGGED = 70;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function AccountPage() {
  const { project } = useProject();
  const params = useParams<{ linkedId: string }>();
  const linkedId = decodeURIComponent(params.linkedId);
  const base = `/projects/${project.id}`;
  const [tab, setTab] = useTab('overview', TABS);
  const [view, setView] = useState<View>('all');
  const { events, truncated, error } = useEvents(project.id, `linkedId=${encodeURIComponent(linkedId)}`, 4);
  const s = useMemo(() => (events ? summarise(events) : null), [events]);
  const latest = events?.[0];
  const latestDetail = useApi<EventResponse>(latest ? `/v1/projects/${project.id}/events/${latest.eventId}` : null);
  const series = useMemo(() => dailySeries(events), [events]);
  const flagged = events?.filter((e) => e.suspectScore >= FLAGGED).length ?? 0;
  const shown: EventSearchItem[] = useMemo(() => (events ?? []).filter((e) => (view === 'all' ? true : view === 'flagged' ? e.suspectScore >= FLAGGED : e.suspectScore < FLAGGED)), [events, view]);

  const devices = useMemo(() => {
    const m = new Map<string, { id: string; events: number; max: number; last: string; browser?: string | null; os?: string | null }>();
    for (const e of events ?? []) {
      const d = m.get(e.visitorId) ?? { id: e.visitorId, events: 0, max: 0, last: e.createdAt, browser: e.browser, os: e.os };
      d.events += 1;
      d.max = Math.max(d.max, e.suspectScore);
      if (e.createdAt > d.last) d.last = e.createdAt;
      m.set(e.visitorId, d);
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [events]);

  const shared = devices.length >= 3;
  const peakTone = s ? scoreTone(s.maxScore) : undefined;
  const summary = s
    ? `${plural(s.total, 'event')} on ${plural(devices.length, 'device')}, from ${plural(s.countries.length, 'country', 'countries')}.${shared ? ' Several devices in a short time can mean a shared or sold login.' : ''}${flagged > 0 ? ` ${plural(flagged, 'event')} scored ${FLAGGED} or more.` : ''}`
    : undefined;

  return (
    <div className="grid gap-5">
      <Link href={`${base}/accounts`} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Accounts</Link>

      <EntityHeader
        kind="Account"
        icon={<UserRound />}
        ring={<ScoreRing value={s ? s.maxScore : null} label={s ? 'peak score' : undefined} />}
        title={<span className="font-mono">{linkedId}</span>}
        badges={<>{shared && <Badge tone="warn">Used on {devices.length} devices</Badge>}{flagged > 0 && <Badge tone="bad">{flagged} flagged</Badge>}</>}
        summary={summary}
        actions={<Button asChild variant="outline"><Link href={`${base}/investigate?tab=graph&type=account&id=${encodeURIComponent(linkedId)}`}><Network className="size-3.5" /> Graph</Link></Button>}
        facts={[
          { label: 'Last device', value: latest ? <Device browser={latest.browser} os={latest.os} /> : '-' },
          { label: 'Last location', value: latest?.country ? <span className="inline-flex items-center gap-1.5"><CountryChip code={latest.country} />{countryName(latest.country)}</span> : '-' },
          { label: 'First activity', value: s?.firstAt ? timeAgo(s.firstAt) : '-' },
          { label: 'Last activity', value: s?.lastAt ? timeAgo(s.lastAt) : '-' },
        ]}
      />
      <ErrorBanner message={error} />

      <KpiGrid
        items={[
          { label: 'Events', icon: <Activity />, value: s ? s.total : '-', hint: truncated ? 'Latest 200 loaded' : undefined, spark: series.events },
          { label: 'Devices', icon: <Laptop />, value: s ? s.visitors.length : '-', tone: shared ? 'warn' : undefined, hint: 'Distinct browsers seen' },
          { label: 'Peak score', icon: <Gauge />, value: s ? s.maxScore : '-', tone: peakTone, hint: s ? `Average ${s.avgScore.toFixed(1)}` : undefined, spark: series.peak, sparkColor: peakTone === 'bad' ? 'var(--bad)' : peakTone === 'warn' ? 'var(--warn)' : 'var(--ok)' },
          { label: 'Flagged events', icon: <ShieldAlert />, value: s ? flagged : '-', tone: flagged > 0 ? 'bad' : undefined, hint: s && s.total > 0 ? `${Math.round((flagged / s.total) * 100)}% of ${s.total} loaded` : undefined },
          { label: 'Countries', icon: <Globe2 />, value: s ? s.countries.length : '-', hint: s ? plural(s.ips.length, 'IP address', 'IP addresses') : undefined },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Account sections">
          <TabsTrigger value="overview"><LayoutGrid /> Overview</TabsTrigger>
          <TabsTrigger value="devices"><Laptop /> Devices {s && <TabCount tone={shared ? 'warn' : undefined}>{devices.length}</TabCount>}</TabsTrigger>
          <TabsTrigger value="timeline"><History /> Timeline {events && <TabCount>{events.length}{truncated ? '+' : ''}</TabCount>}</TabsTrigger>
          <TabsTrigger value="events"><Table2 /> Events {flagged > 0 && <TabCount tone="bad">{flagged} flagged</TabCount>}</TabsTrigger>
          <TabsTrigger value="profile"><Cpu /> Device and network</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <EntityInsights events={events} basePath={base} />
            <div className="grid gap-5">
              <VerdictCard event={latestDetail.data ?? null} basePath={base} />
              <Card>
                <CardHeader title="Recent activity" action={<button type="button" onClick={() => setTab('timeline')} className="text-xs font-medium text-signal-ink hover:underline">See all</button>} />
                {events ? <DayTimeline events={events.slice(0, 4)} basePath={base} compact /> : <Skeleton className="m-5 h-32" />}
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="devices">
          <Card className="overflow-hidden">
            <CardHeader title="Devices that used this account" description="More than a couple, in a short time, often means a shared or sold login." />
            {!events ? <Skeleton className="m-5 h-32" /> : devices.length === 0 ? <EmptyState title="No devices yet" /> : (
              <Table>
                <thead><tr><Th>Visitor</Th><Th>Device</Th><Th className="text-right">Events</Th><Th>Peak score</Th><Th>Last seen</Th></tr></thead>
                <tbody>
                  {devices.map((d) => (
                    <Tr key={d.id}>
                      <Td><EntityLink href={`${base}/visitors/${d.id}`} mono>{d.id}</EntityLink></Td>
                      <Td><Device browser={d.browser} os={d.os} /></Td>
                      <Td className="tnum text-right">{d.events}</Td>
                      <Td><Badge tone={scoreTone(d.max)}>{d.max}</Badge></Td>
                      <Td><When iso={d.last} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader title="Timeline" description="Every identify call for this account, newest first" action={<Segmented<View> value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'flagged', label: `Flagged ${flagged}` }, { value: 'clean', label: 'Clean' }]} />} />
            {events ? <DayTimeline events={shown} basePath={base} empty="No events in this view." /> : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="overflow-hidden">
            <CardHeader title="Events" description={events ? `${shown.length} of ${events.length}${truncated ? '+' : ''} loaded` : undefined} action={<Segmented<View> value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'flagged', label: 'Flagged' }, { value: 'clean', label: 'Clean' }]} />} />
            {events ? (shown.length > 0 ? <EventsTable events={shown} basePath={base} showAccount={false} /> : <EmptyState title="No events in this view." />) : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>

        <TabsContent value="profile">
          {latestDetail.data ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <DeviceProfile event={latestDetail.data} />
              <NetworkProfile event={latestDetail.data} />
            </div>
          ) : <Skeleton className="h-64" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
