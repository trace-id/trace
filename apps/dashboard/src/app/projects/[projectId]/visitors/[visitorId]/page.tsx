'use client';

import type { EventResponse, EventSearchItem, VisitorHistoryResponse } from '@trace-id/signals/api';
import { Activity, ArrowLeft, Cpu, Fingerprint, Gauge, Globe2, History, LayoutGrid, Network, ShieldAlert, Table2, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CountryChip, MatchBadge } from '@/components/domain';
import { DayTimeline, EntityHeader, KpiGrid, ScoreRing, VerdictCard, dailySeries } from '@/components/entity-page';
import { EntityInsights, EventsTable } from '@/components/entity';
import { QuickList } from '@/components/lists/quick-list';
import { DeviceProfile, NetworkProfile } from '@/components/profiles';
import { Dialog, DialogClose, DialogContent, DialogTrigger, Tabs, TabCount, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Id, Segmented, Skeleton } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { countryName } from '@/lib/country';
import { formatDateTime, num, scoreTone, timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';
import { summarise, useEvents } from '@/lib/use-events';
import { useTab } from '@/lib/use-tab';
import { DeviceCell } from '@/components/logos';

const TABS = ['overview', 'timeline', 'events', 'accounts', 'profile'] as const;
type View = 'all' | 'flagged' | 'clean';
const FLAGGED = 70;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function VisitorPage() {
  const { project, canEdit } = useProject();
  const { visitorId } = useParams<{ visitorId: string }>();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const [tab, setTab] = useTab('overview', TABS);
  const [view, setView] = useState<View>('all');
  const history = useApi<VisitorHistoryResponse>(`/v1/projects/${project.id}/visitors/${visitorId}?limit=1`);
  const { events, truncated, error } = useEvents(project.id, `visitorId=${visitorId}`, 4);
  const [delError, setDelError] = useState<string | null>(null);
  const s = useMemo(() => (events ? summarise(events) : null), [events]);
  const h = history.data;
  const latest = events?.[0];
  const latestDetail = useApi<EventResponse>(latest ? `/v1/projects/${project.id}/events/${latest.eventId}` : null);
  const series = useMemo(() => dailySeries(events), [events]);
  const flagged = events?.filter((e) => e.suspectScore >= FLAGGED).length ?? 0;

  const shown: EventSearchItem[] = useMemo(() => (events ?? []).filter((e) => (view === 'all' ? true : view === 'flagged' ? e.suspectScore >= FLAGGED : e.suspectScore < FLAGGED)), [events, view]);
  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; events: number; peak: number; last: string }>();
    for (const e of events ?? []) {
      if (!e.linkedId) continue;
      const cur = m.get(e.linkedId) ?? { id: e.linkedId, events: 0, peak: 0, last: e.createdAt };
      cur.events += 1;
      cur.peak = Math.max(cur.peak, e.suspectScore);
      if (e.createdAt > cur.last) cur.last = e.createdAt;
      m.set(e.linkedId, cur);
    }
    return [...m.values()].sort((a, b) => b.events - a.events);
  }, [events]);

  async function remove() {
    try {
      await api(`/v1/projects/${project.id}/visitors/${visitorId}`, { method: 'DELETE' });
      router.push(`${base}/visitors`);
    } catch (e) {
      setDelError(errorMessage(e));
    }
  }

  if (history.error) return <ErrorBanner message={history.error} />;

  const peakTone = s ? scoreTone(s.maxScore) : undefined;
  const where = s ? [s.countries.length > 0 ? plural(s.countries.length, 'country', 'countries') : null, plural(s.ips.length, 'IP address', 'IP addresses')].filter(Boolean).join(' and ') : '';
  const verdict = s ? (flagged > 0 ? `${plural(flagged, 'event')} scored ${FLAGGED} or more.` : s.maxScore >= 30 ? `The highest score is ${s.maxScore}, below the ${FLAGGED} that counts as flagged.` : 'Nothing here looks risky.') : '';
  const summary = s && h ? `Seen ${plural(h.eventCount, 'time')}${h.firstSeenAt ? `, first ${timeAgo(h.firstSeenAt)}` : ''}, from ${where}${s.accounts.length ? `, linked to ${plural(s.accounts.length, 'account')}` : ''}. ${verdict}` : undefined;

  return (
    <div className="grid gap-5">
      <Link href={`${base}/visitors`} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Visitors</Link>

      <EntityHeader
        kind="Visitor"
        icon={<Fingerprint />}
        ring={<ScoreRing value={s ? s.maxScore : null} label={s ? 'peak score' : undefined} />}
        title={<Id value={visitorId} className="text-[22px] text-ink" />}
        badges={<>{latest && <MatchBadge kind={latest.matchKind} />}{flagged > 0 && <Badge tone="bad">{flagged} flagged</Badge>}</>}
        summary={summary}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`${base}/investigate?tab=graph&type=visitor&id=${visitorId}`}><Network className="size-3.5" /> Graph</Link></Button>
            <QuickList kind="visitor" value={visitorId} />
            {canEdit && (
              <Dialog>
                <DialogTrigger asChild><Button variant="outline" size="icon" aria-label="Delete this visitor's data"><Trash2 className="size-3.5" /></Button></DialogTrigger>
                <DialogContent title="Delete this visitor?" description="Removes the visitor and every event recorded for it. This is for data-subject deletion requests and cannot be undone.">
                  <ErrorBanner message={delError} />
                  <div className="mt-2 flex justify-end gap-2">
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button variant="danger" onClick={remove}>Delete permanently</Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </>
        }
        facts={[
          { label: 'Device', value: latest ? (<DeviceCell browser={latest.browser} os={latest.os} />) : '-' },
          { label: 'Last location', value: latest?.country ? <span className="inline-flex items-center gap-1.5"><CountryChip code={latest.country} />{countryName(latest.country)}</span> : '-' },
          { label: 'First seen', value: h ? timeAgo(h.firstSeenAt) : '-' },
          { label: 'Last seen', value: h ? timeAgo(h.lastSeenAt) : '-' },
          { label: 'Device id', value: h ? <Id value={h.deviceId} short={10} /> : '-' },
        ]}
      />
      <ErrorBanner message={error} />

      <KpiGrid
        items={[
          { label: 'Events', icon: <Activity />, value: h ? num(h.eventCount) : '-', hint: h ? `since ${formatDateTime(h.firstSeenAt).split(',')[0]}` : undefined, spark: series.events },
          { label: 'Peak score', icon: <Gauge />, value: s ? s.maxScore : '-', tone: peakTone, hint: s ? `Average ${s.avgScore.toFixed(1)}` : undefined, spark: series.peak, sparkColor: peakTone === 'bad' ? 'var(--bad)' : peakTone === 'warn' ? 'var(--warn)' : 'var(--ok)' },
          { label: 'Flagged events', icon: <ShieldAlert />, value: s ? flagged : '-', tone: flagged > 0 ? 'bad' : undefined, hint: s && s.total > 0 ? `${Math.round((flagged / s.total) * 100)}% of ${s.total} loaded` : undefined },
          { label: 'Accounts', icon: <Users />, value: s ? s.accounts.length : '-', hint: 'Distinct linked ids' },
          { label: 'IP addresses', icon: <Globe2 />, value: s ? s.ips.length : '-', hint: s ? plural(s.countries.length, 'country', 'countries') : undefined },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Visitor sections">
          <TabsTrigger value="overview"><LayoutGrid /> Overview</TabsTrigger>
          <TabsTrigger value="timeline"><History /> Timeline {events && <TabCount>{events.length}{truncated ? '+' : ''}</TabCount>}</TabsTrigger>
          <TabsTrigger value="events"><Table2 /> Events {flagged > 0 && <TabCount tone="bad">{flagged} flagged</TabCount>}</TabsTrigger>
          <TabsTrigger value="accounts"><Users /> Accounts {s && <TabCount>{s.accounts.length}</TabCount>}</TabsTrigger>
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

        <TabsContent value="timeline">
          <Card>
            <CardHeader title="Timeline" description="Every identify call from this visitor, newest first" action={<Segmented<View> value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'flagged', label: `Flagged ${flagged}` }, { value: 'clean', label: 'Clean' }]} />} />
            {events ? <DayTimeline events={shown} basePath={base} empty="No events in this view." /> : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="overflow-hidden">
            <CardHeader title="Events" description={events ? `${shown.length} of ${events.length}${truncated ? '+' : ''} loaded` : undefined} action={<Segmented<View> value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'flagged', label: 'Flagged' }, { value: 'clean', label: 'Clean' }]} />} />
            {events ? (shown.length > 0 ? <EventsTable events={shown} basePath={base} showVisitor={false} /> : <EmptyState title="No events in this view." />) : <Skeleton className="m-5 h-40" />}
            {truncated && <p className="border-t border-line px-4 py-3 text-xs text-ink-3">Showing the latest 200. <Link href={`${base}/events?visitorId=${visitorId}`} className="text-signal hover:underline">Open all in Events</Link></p>}
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          {!events ? <Skeleton className="h-40" /> : accounts.length === 0 ? (
            <Card><EmptyState icon={<Users className="size-5" />} title="No linked ids" description="Pass a linkedId (your user id) when you identify to see which accounts this visitor used." /></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((a) => (
                <Link key={a.id} href={`${base}/accounts/${encodeURIComponent(a.id)}`} className="group rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-signal">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-9 place-items-center rounded-xl bg-signal-soft text-signal-ink"><Users className="size-4" /></span>
                    <Badge tone={scoreTone(a.peak)}>Peak {a.peak}</Badge>
                  </div>
                  <p className="mt-3 truncate font-mono text-[13px] font-medium text-ink group-hover:text-signal">{a.id}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{plural(a.events, 'event')} · last {timeAgo(a.last)}</p>
                </Link>
              ))}
            </div>
          )}
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
