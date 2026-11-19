'use client';

import type { VisitorHistoryResponse } from '@trace-id/signals/api';
import { ArrowLeft, Fingerprint, Network, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EntityInsights, EventsTable, Timeline } from '@/components/entity';
import { DeviceProfile, NetworkProfile } from '@/components/profiles';
import type { EventResponse } from '@trace-id/signals/api';
import { CountryChip, EntityHero, EntityLink, RiskBadge, StatStrip } from '@/components/domain';
import { Button, Card, CardHeader, ErrorBanner, Id, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogClose, DialogContent, DialogTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { countryName } from '@/lib/country';
import { formatDateTime, num, timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { summarise, useEvents } from '@/lib/use-events';
import { useApi } from '@/lib/use-api';

export default function VisitorPage() {
  const { project, canEdit } = useProject();
  const { visitorId } = useParams<{ visitorId: string }>();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const history = useApi<VisitorHistoryResponse>(`/v1/projects/${project.id}/visitors/${visitorId}?limit=1`);
  const { events, truncated, error } = useEvents(project.id, `visitorId=${visitorId}`, 4);
  const [delError, setDelError] = useState<string | null>(null);
  const s = useMemo(() => (events ? summarise(events) : null), [events]);
  const h = history.data;
  const latest = events?.[0];
  const latestDetail = useApi<EventResponse>(latest ? `/v1/projects/${project.id}/events/${latest.eventId}` : null);

  async function remove() {
    try {
      await api(`/v1/projects/${project.id}/visitors/${visitorId}`, { method: 'DELETE' });
      router.push(`${base}/visitors`);
    } catch (e) {
      setDelError(errorMessage(e));
    }
  }

  if (history.error) return <ErrorBanner message={history.error} />;

  return (
    <div className="grid gap-5">
      <Link href={`${base}/visitors`} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Visitors</Link>
      <EntityHero
        icon={<Fingerprint />}
        kind="Visitor"
        title={<Id value={visitorId} className="text-xl text-ink" />}
        badges={s ? <RiskBadge value={s.maxScore} /> : undefined}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`${base}/investigate?tab=graph&type=visitor&id=${visitorId}`}><Network className="size-3.5" /> Open in graph</Link></Button>
            {canEdit && (
              <Dialog>
                <DialogTrigger asChild><Button variant="outline"><Trash2 className="size-3.5" /> Delete data</Button></DialogTrigger>
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
          { label: 'Device', value: latest ? ([latest.browser, latest.os].filter(Boolean).join(' · ') || 'Unknown') : '-' },
          { label: 'Last location', value: latest?.country ? <span className="inline-flex items-center gap-1.5"><CountryChip code={latest.country} />{countryName(latest.country)}</span> : '-' },
          { label: 'First seen', value: h ? timeAgo(h.firstSeenAt) : '-' },
          { label: 'Last seen', value: h ? timeAgo(h.lastSeenAt) : '-' },
          { label: 'Device id', value: h ? <Id value={h.deviceId} short={10} /> : '-' },
        ]}
      />
      <ErrorBanner message={error} />

      <StatStrip
        items={[
          { label: 'Events', value: h ? num(h.eventCount) : '-', hint: h ? `since ${formatDateTime(h.firstSeenAt).split(',')[0]}` : undefined },
          { label: 'Peak score', value: s ? s.maxScore : '-', tone: s ? (s.maxScore >= 70 ? 'bad' : s.maxScore >= 30 ? 'warn' : 'ok') : undefined, hint: s ? `Average ${s.avgScore.toFixed(1)}` : undefined },
          { label: 'Accounts', value: s ? s.accounts.length : '-', hint: 'Distinct linked ids' },
          { label: 'IP addresses', value: s ? s.ips.length : '-', hint: s ? `${s.countries.length} countr${s.countries.length === 1 ? 'y' : 'ies'}` : undefined },
        ]}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="events">Events {events && <span className="ml-1 text-ink-3">{events.length}{truncated ? '+' : ''}</span>}</TabsTrigger>
          <TabsTrigger value="accounts">Accounts {s && <span className="ml-1 text-ink-3">{s.accounts.length}</span>}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-5">
            <EntityInsights events={events} basePath={base} />
            {latestDetail.data && (
              <div className="grid gap-5 xl:grid-cols-2">
                <DeviceProfile event={latestDetail.data} />
                <NetworkProfile event={latestDetail.data} />
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="timeline">
          <Card>
            <CardHeader title="Timeline" description="Every identify call from this visitor, newest first" />
            {events ? <Timeline events={events} basePath={base} /> : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>
        <TabsContent value="events">
          <Card className="overflow-hidden">
            {events ? <EventsTable events={events} basePath={base} showVisitor={false} /> : <Skeleton className="m-5 h-40" />}
            {truncated && <p className="border-t border-line px-4 py-3 text-xs text-ink-3">Showing the latest 200. <Link href={`${base}/events?visitorId=${visitorId}`} className="text-signal hover:underline">Open all in Events</Link></p>}
          </Card>
        </TabsContent>
        <TabsContent value="accounts">
          <Card>
            <CardHeader title="Accounts used by this visitor" description="Linked ids seen with this device, by number of events" />
            <ul className="px-5 pb-4">
              {(s?.accounts ?? []).map(([id, n]) => (
                <li key={id} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-b-0">
                  <EntityLink href={`${base}/accounts/${encodeURIComponent(id)}`} mono>{id}</EntityLink>
                  <span className="tnum text-ink-3">{n} events</span>
                </li>
              ))}
              {s && s.accounts.length === 0 && <li className="py-6 text-center text-[13px] text-ink-3">No linked ids recorded.</li>}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
