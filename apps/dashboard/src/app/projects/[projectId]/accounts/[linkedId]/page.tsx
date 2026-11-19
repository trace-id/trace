'use client';

import { ArrowLeft, Network, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { EntityInsights, EventsTable, Timeline } from '@/components/entity';
import { DeviceProfile, NetworkProfile } from '@/components/profiles';
import type { EventResponse } from '@trace-id/signals/api';
import { useApi } from '@/lib/use-api';
import { CountryChip, Device, EntityHero, EntityLink, RiskBadge, StatStrip, When } from '@/components/domain';
import { Badge, Button, Card, CardHeader, ErrorBanner, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { countryName } from '@/lib/country';
import { timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { summarise, useEvents } from '@/lib/use-events';

export default function AccountPage() {
  const { project } = useProject();
  const params = useParams<{ linkedId: string }>();
  const linkedId = decodeURIComponent(params.linkedId);
  const base = `/projects/${project.id}`;
  const { events, truncated, error } = useEvents(project.id, `linkedId=${encodeURIComponent(linkedId)}`, 4);
  const s = useMemo(() => (events ? summarise(events) : null), [events]);
  const latest = events?.[0];
  const latestDetail = useApi<EventResponse>(latest ? `/v1/projects/${project.id}/events/${latest.eventId}` : null);

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

  return (
    <div className="grid gap-5">
      <Link href={`${base}/accounts`} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Accounts</Link>
      <EntityHero
        icon={<UserRound />}
        kind="Account"
        title={<span className="font-mono">{linkedId}</span>}
        badges={
          <>
            {s && <RiskBadge value={s.maxScore} />}
            {shared && <Badge tone="warn">Used on {devices.length} devices</Badge>}
          </>
        }
        actions={<Button asChild variant="outline"><Link href={`${base}/investigate?tab=graph&type=account&id=${encodeURIComponent(linkedId)}`}><Network className="size-3.5" /> Open in graph</Link></Button>}
        facts={[
          { label: 'Last device', value: latest ? <Device browser={latest.browser} os={latest.os} /> : '-' },
          { label: 'Last location', value: latest?.country ? <span className="inline-flex items-center gap-1.5"><CountryChip code={latest.country} />{countryName(latest.country)}</span> : '-' },
          { label: 'First activity', value: s?.firstAt ? timeAgo(s.firstAt) : '-' },
          { label: 'Last activity', value: s?.lastAt ? timeAgo(s.lastAt) : '-' },
        ]}
      />
      <ErrorBanner message={error} />

      <StatStrip
        items={[
          { label: 'Events', value: s ? s.total : '-', hint: truncated ? 'Latest 200 loaded' : undefined },
          { label: 'Devices', value: s ? s.visitors.length : '-', tone: shared ? 'warn' : undefined, hint: 'Distinct browsers seen' },
          { label: 'Peak score', value: s ? s.maxScore : '-', tone: s ? (s.maxScore >= 70 ? 'bad' : s.maxScore >= 30 ? 'warn' : 'ok') : undefined, hint: s ? `Average ${s.avgScore.toFixed(1)}` : undefined },
          { label: 'Countries', value: s ? s.countries.length : '-', hint: s ? `${s.ips.length} IP addresses` : undefined },
        ]}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="devices">Devices {s && <span className="ml-1 text-ink-3">{devices.length}</span>}</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
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
        <TabsContent value="devices">
          <Card className="overflow-hidden">
            <CardHeader title="Devices that used this account" description="More than a couple, in a short time, often means a shared or sold login." />
            {!events ? <Skeleton className="m-5 h-32" /> : (
              <Table>
                <thead><tr><Th>Visitor</Th><Th>Device</Th><Th className="text-right">Events</Th><Th>Peak score</Th><Th>Last seen</Th></tr></thead>
                <tbody>
                  {devices.map((d) => (
                    <Tr key={d.id}>
                      <Td><EntityLink href={`${base}/visitors/${d.id}`} mono>{d.id}</EntityLink></Td>
                      <Td><Device browser={d.browser} os={d.os} /></Td>
                      <Td className="tnum text-right">{d.events}</Td>
                      <Td>{d.max >= 70 ? <Badge tone="bad">{d.max}</Badge> : d.max >= 30 ? <Badge tone="warn">{d.max}</Badge> : <Badge tone="ok">{d.max}</Badge>}</Td>
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
            <CardHeader title="Timeline" description="Every identify call for this account, newest first" />
            {events ? <Timeline events={events} basePath={base} /> : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>
        <TabsContent value="events">
          <Card className="overflow-hidden">
            {events ? <EventsTable events={events} basePath={base} showAccount={false} /> : <Skeleton className="m-5 h-40" />}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

