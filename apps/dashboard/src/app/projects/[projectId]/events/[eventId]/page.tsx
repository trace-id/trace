'use client';

import type { EventLabelsResponse, EventResponse } from '@trace-id/signals/api';
import { Activity, ArrowLeft, Ban, Bot, Check, ChevronLeft, ChevronRight, Flag, Network, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntityHero, EntityLink, KV, MatchBadge, Place, RiskBadge, SignalChip } from '@/components/domain';
import { Timeline } from '@/components/entity';
import { DeviceProfile, NetworkProfile } from '@/components/profiles';
import { Device } from '@/components/domain';
import { useEvents } from '@/lib/use-events';
import { Badge, Button, Card, CardHeader, ErrorBanner, Id, Input, Skeleton } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { scoreTone, formatDateTime, pct, timeAgo } from '@/lib/format';
import { clientName } from '@/lib/clients';
import { QuickList } from '@/components/lists/quick-list';
import { useProject } from '@/lib/project-context';
import { SIGNALS, signalMeta } from '@/lib/signals';
import { useApi } from '@/lib/use-api';
import { parseUa } from '@/lib/ua-parse';
const uaLabelsOf = (ua: string) => parseUa(ua);

const GROUP_ORDER = ['Automation', 'Network', 'Device', 'Account', 'Request'] as const;

function ScoreDial({ value }: { value: number }) {
  const tone = scoreTone(value);
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)';
  const r = 54;
  const c = Math.PI * r;
  return (
    <div className="relative mx-auto grid w-[148px] justify-items-center">
      <svg width="148" height="88" viewBox="0 0 148 88" role="img" aria-label={`Suspect score ${value} of 100`}>
        <path d="M 20 78 A 54 54 0 0 1 128 78" fill="none" stroke="var(--surface-3)" strokeWidth="12" strokeLinecap="round" />
        <path d="M 20 78 A 54 54 0 0 1 128 78" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-x-0 top-8 text-center">
        <div className="tnum text-[34px] font-semibold leading-none tracking-tight" style={{ color }}>{value}</div>
        <div className="mt-1 text-[11px] text-ink-3">of 100</div>
      </div>
    </div>
  );
}

function LabelPanel({ event }: { event: EventResponse }) {
  const { project, canEdit } = useProject();
  const base = `/v1/projects/${project.id}/events/${event.eventId}/labels`;
  const labels = useApi<EventLabelsResponse>(base);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      labels.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const put = (label: string, fraud: boolean) => run(() => api(`${base}/${label}`, { method: 'PUT', body: { fraud } }));

  return (
    <Card>
      <CardHeader title="Fraud labels" description="Teach this project's fraud models. Mark what this event was, or wasn't." />
      <div className="grid gap-3 px-5 pb-5">
        <ErrorBanner message={error ?? labels.error} />
        {labels.data?.labels.length === 0 && <p className="text-[13px] text-ink-3">Not labelled yet.</p>}
        {labels.data?.labels.map((l) => (
          <div key={l.label} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
            <div className="flex items-center gap-2 text-[13px]">
              <Badge tone={l.fraud ? 'bad' : 'ok'}>{l.fraud ? 'Fraud' : 'Not fraud'}</Badge>
              <span className="font-mono text-xs">{l.label}</span>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => put(l.label, !l.fraud)}>Flip</Button>
                <Button size="sm" variant="danger-ghost" onClick={() => run(() => api(`${base}/${l.label}`, { method: 'DELETE' }))}>Remove</Button>
              </div>
            )}
          </div>
        ))}
        {canEdit ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name) void put(name, true).then(() => setName(''));
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="Fraud type, e.g. account_takeover" pattern="[a-z][a-z0-9_]{0,31}" maxLength={32} />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={!name}><Flag className="size-3.5" /> Mark as fraud</Button>
              <Button type="button" variant="outline" size="sm" disabled={!name} onClick={() => void put(name, false).then(() => setName(''))}><Check className="size-3.5" /> Not fraud</Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-ink-3">Viewers cannot label events.</p>
        )}
      </div>
    </Card>
  );
}

export default function EventPage() {
  const { project, canEdit } = useProject();
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const ev = useApi<EventResponse>(`/v1/projects/${project.id}/events/${eventId}`);
  const e = ev.data;
  const visitorEvents = useEvents(project.id, e ? `visitorId=${e.visitorId}` : 'visitorId=none', 1);

  if (ev.error) return <ErrorBanner message={ev.error} />;
  if (!e) return <div className="grid gap-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;

  const fired = SIGNALS.filter((s) => e.signals[s.id as keyof typeof e.signals]?.detected);
  const quiet = SIGNALS.filter((s) => !e.signals[s.id as keyof typeof e.signals]?.detected);
  const ua = e.attributes.userAgent ?? '';
  const siblings = visitorEvents.events ?? [];
  const at = siblings.findIndex((x) => x.eventId === e.eventId);
  const newer = at > 0 ? siblings[at - 1] : undefined;
  const older = at >= 0 ? siblings[at + 1] : undefined;

  return (
    <div className="grid gap-5">
      <Link href={`${base}/events`} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" /> Events</Link>
      <EntityHero
        aside={<ScoreDial value={e.suspectScore} />}
        icon={<Activity />}
        kind={`Event · ${formatDateTime(e.createdAt)}`}
        title={<Id value={e.eventId} short={18} className="text-xl text-ink" />}
        badges={<><MatchBadge kind={e.matchKind} /><RiskBadge value={e.suspectScore} /></>}
        actions={
          <>
            <Button variant="outline" size="icon" aria-label="Newer event" disabled={!newer} onClick={() => newer && router.push(`${base}/events/${newer.eventId}`)}><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" size="icon" aria-label="Older event" disabled={!older} onClick={() => older && router.push(`${base}/events/${older.eventId}`)}><ChevronRight className="size-4" /></Button>
            <Button asChild variant="outline"><Link href={`${base}/investigate?tab=graph&type=visitor&id=${e.visitorId}`}><Network className="size-3.5" /> Graph</Link></Button>
          </>
        }
        facts={[
          { label: 'Visitor', value: <EntityLink href={`${base}/visitors/${e.visitorId}`} mono>{e.visitorId.slice(0, 12)}…</EntityLink> },
          { label: 'Account', value: e.linkedId ? <EntityLink href={`${base}/accounts/${encodeURIComponent(e.linkedId)}`} mono>{e.linkedId}</EntityLink> : <span className="text-ink-3">None</span> },
          { label: 'Location', value: <span className="inline-flex items-center gap-1.5"><Place code={e.ip.country} /></span> },
          { label: 'IP address', value: <span className="font-mono text-xs">{e.ip.address ?? '-'}</span> },
          { label: 'Device', value: <Device browser={uaLabelsOf(ua).browser} os={uaLabelsOf(ua).os} deviceType={uaLabelsOf(ua).deviceKind} /> },
          { label: 'Match confidence', value: pct(e.confidence) },
        ]}
      />

      {e.list && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-[13px]', e.list.action === 'block' ? 'border-bad/30 bg-bad-soft text-bad' : 'border-ok/30 bg-ok-soft text-ok')} role="status">
          {e.list.action === 'block' ? <Ban className="size-4 shrink-0" /> : <ShieldCheck className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">
            <b>{e.list.action === 'block' ? 'Blocked' : 'Allowed'} by your list.</b> It matched the {e.list.kind === 'cidr' ? 'range' : e.list.kind} <span className="font-mono text-xs">{e.list.value}</span>{e.list.note && <> ({e.list.note})</>}, so the score is {e.suspectScore}. The signals alone gave {e.list.scoreBefore}.
          </span>
          <Link href={`${base}/lists`} className="underline">Open the lists</Link>
        </div>
      )}
      {canEdit && (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-[13px] font-medium text-ink-2">Always treat as</span>
          {e.ip.address && !/.0$/.test(e.ip.address) && <QuickList kind="ip" value={e.ip.address} label="this IP" />}
          <QuickList kind="visitor" value={e.visitorId} label="this visitor" />
          {e.deviceId !== e.visitorId && <QuickList kind="device" value={e.deviceId} label="this device" />}
          {e.linkedId && <QuickList kind="linked" value={e.linkedId} label="this account" />}
        </Card>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <Tabs defaultValue="signals">
            <TabsList>
              <TabsTrigger value="signals">Signals <span className="ml-1 text-ink-3">{fired.length}</span></TabsTrigger>
              <TabsTrigger value="device">Device</TabsTrigger>
              <TabsTrigger value="network">Network</TabsTrigger>
              <TabsTrigger value="linked">Linked {e.linkedVisitors.length > 0 && <span className="ml-1 text-ink-3">{e.linkedVisitors.length}</span>}</TabsTrigger>
              {e.fraudScores && e.fraudScores.length > 0 && <TabsTrigger value="models">Fraud models</TabsTrigger>}
              <TabsTrigger value="raw">Raw</TabsTrigger>
            </TabsList>

            <TabsContent value="signals">
              {e.reasons.length > 0 && (
                <Card className="mb-4 p-5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Why this score</h4>
                  <ul className="mt-3 grid gap-3">
                    {[...e.reasons].sort((a, b) => b.contribution - a.contribution).map((r) => (
                      <li key={r.signal} className="grid grid-cols-[180px_1fr_44px] items-center gap-3 text-[13px] max-sm:grid-cols-[1fr_44px]">
                        <span className="truncate text-ink">{signalMeta(r.signal).title}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-surface-3 max-sm:hidden"><span className="block h-full rounded-full bg-bad" style={{ width: `${Math.min(100, r.contribution)}%` }} /></span>
                        <span className="tnum text-right font-semibold text-bad">+{r.contribution}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {e.botInfo && e.botInfo.result !== 'notDetected' && (
                <Card className="mb-4 flex items-start gap-3 p-4">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', e.botInfo.result === 'good' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}><Bot className="size-[18px]" /></span>
                  <div className="text-[13px]">
                    <p className="font-medium text-ink">{e.botInfo.result === 'good' ? 'Known good bot' : 'Bad bot'}{e.botInfo.name && ` · ${e.botInfo.name}`}</p>
                    <p className="mt-0.5 text-ink-3">{[e.botInfo.type, e.botInfo.provider, e.botInfo.identity].filter(Boolean).join(' · ')}</p>
                  </div>
                </Card>
              )}
              {GROUP_ORDER.map((group) => {
                const list = fired.filter((s) => s.group === group);
                if (list.length === 0) return null;
                return (
                  <div key={group} className="mb-4">
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{group}</h4>
                    <div className="grid gap-2">
                      {list.map((s) => {
                        const details = e.signals[s.id as keyof typeof e.signals]?.details ?? {};
                        const pts = e.reasons.find((r) => r.signal === s.id)?.contribution;
                        return (
                          <Card key={s.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <ShieldAlert className="size-4 text-bad" />
                                <span className="text-[13px] font-semibold text-ink">{s.title}</span>
                              </div>
                              {pts !== undefined && <Badge tone="bad">+{pts}</Badge>}
                            </div>
                            <p className="mt-1.5 text-[13px] text-ink-3">{s.description}</p>
                            {Object.keys(details).length > 0 && (
                              <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-5 text-ink-2">{JSON.stringify(details, null, 2)}</pre>
                            )}
                            <details className="mt-2 text-xs text-ink-3">
                              <summary className="cursor-pointer hover:text-ink">When is this a false alarm?</summary>
                              <p className="mt-1.5 leading-relaxed">{s.falsePositives}</p>
                            </details>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {fired.length === 0 && (
                <Card className="flex items-center gap-3 p-5 text-[13px] text-ink-2"><ShieldCheck className="size-5 text-ok" /> No signals were detected on this event.</Card>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] text-ink-3 hover:text-ink">{quiet.length} signals that did not fire</summary>
                <div className="mt-3 flex flex-wrap gap-1.5">{quiet.map((s) => <SignalChip key={s.id} id={s.id} />)}</div>
              </details>
            </TabsContent>

            <TabsContent value="device">
              <DeviceProfile event={e} />
              {e.app && (
                <Card className="mt-4 px-5 py-2">
                  <CardHeader title="Mobile app" className="px-0" />
                  <dl>
                    <KV label="Platform">{e.app.platform}</KV>
                    <KV label="App" mono>{e.app.appId ?? '-'} {e.app.appVersion && `(${e.app.appVersion})`}</KV>
                    <KV label="Device">{[e.app.manufacturer, e.app.model].filter(Boolean).join(' ') || '-'}</KV>
                    <KV label="OS version">{e.app.osVersion ?? '-'}</KV>
                    <KV label="Real device">{e.app.isDevice === null ? 'Unknown' : e.app.isDevice ? 'Yes' : 'Emulator'}</KV>
                    <KV label="Rooted or jailbroken">{e.app.rooted === null ? 'Unknown' : e.app.rooted ? 'Likely' : 'No'}</KV>
                  </dl>
                </Card>
              )}
              {e.client && (
                <Card className="mt-4 px-5 py-2">
                  <CardHeader title="Captured by" description="The client package that sent this event." className="px-0" />
                  <dl>
                    <KV label="Client">{clientName((e.client.via ?? e.client.sdk).name)}</KV>
                    <KV label="Package" mono>{(e.client.via ?? e.client.sdk).name}</KV>
                    <KV label="Version" mono>{(e.client.via ?? e.client.sdk).version}</KV>
                    {e.client.via && <KV label="Collection engine" mono>{e.client.sdk.name} {e.client.sdk.version}</KV>}
                  </dl>
                </Card>
              )}
              <Card className="mt-4">
                <CardHeader title="Fingerprint components" description="Each reading is hashed in the browser; only the hash is stored." />
                <div className="grid gap-x-8 px-5 pb-4 sm:grid-cols-2">
                  {Object.entries(e.components).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"><span className="text-ink-2">{k}</span><span className="font-mono text-xs text-ink-3">{v.slice(0, 12)}</span></div>
                  ))}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="network">
              <NetworkProfile event={e} />
              {e.tags && (
                <Card className="mt-4 px-5 py-2">
                  <CardHeader title="Tags" className="px-0" />
                  <dl>{Object.entries(e.tags).map(([k, v]) => <KV key={k} label={k}>{String(v)}</KV>)}</dl>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="linked">
              {e.linkedVisitors.length === 0 ? (
                <Card className="p-6 text-[13px] text-ink-3">No other browsers were linked to this device.</Card>
              ) : (
                <div className="grid gap-2">
                  {e.linkedVisitors.map((l) => (
                    <Card key={l.visitorId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <EntityLink href={`${base}/visitors/${l.visitorId}`} mono>{l.visitorId}</EntityLink>
                        <p className="mt-0.5 text-xs text-ink-3">{l.browser} · last seen {timeAgo(l.lastSeenAt)} · {l.via === 'sharedNetwork' ? `${l.sharedNetworks} shared network${l.sharedNetworks === 1 ? '' : 's'}` : 'matched on rare hardware'}</p>
                      </div>
                      <Badge tone={l.confidence > 0.9 ? 'ok' : 'warn'}>{pct(l.confidence)} match</Badge>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {e.fraudScores && e.fraudScores.length > 0 && (
              <TabsContent value="models">
                <div className="grid gap-3">
                  {e.fraudScores.map((f) => (
                    <Card key={f.label} className="p-4">
                      <div className="flex items-center justify-between"><span className="font-mono text-[13px] font-medium">{f.label}</span><Badge tone={f.probability >= 0.5 ? 'bad' : 'neutral'}>{pct(f.probability, 0)} likely</Badge></div>
                      {f.reasons.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{f.reasons.map((r) => <span key={r} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-ink-2">{signalMeta(r).title}</span>)}</div>}
                    </Card>
                  ))}
                </div>
              </TabsContent>
            )}

            <TabsContent value="raw">
              <Card className="p-0">
                <div className="flex items-center justify-between px-5 pt-4"><h3 className="text-[13px] font-semibold">Event JSON</h3><span className="text-xs text-ink-3">As returned by the Events API</span></div>
                <pre className="m-4 max-h-[560px] overflow-auto rounded-xl bg-surface-2 p-4 font-mono text-[11.5px] leading-5 text-ink-2">{JSON.stringify(e, null, 2)}</pre>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
        <div className="grid content-start gap-5">
          <LabelPanel event={e} />
          <Card>
            <CardHeader title="Visitor timeline" description={`Recent events from ${e.visitorId.slice(0, 8)}…`} action={<Link href={`${base}/visitors/${e.visitorId}`} className="text-xs font-medium text-signal hover:underline">Open visitor</Link>} />
            {visitorEvents.events ? <Timeline events={visitorEvents.events} basePath={base} currentId={e.eventId} limit={8} /> : <Skeleton className="m-5 h-32" />}
          </Card>
          <p className="px-1 text-xs text-ink-3">Verifiable through the Events API until {formatDateTime(e.expiresAt)}. {timeAgo(e.createdAt)}.</p>
        </div>
      </div>
    </div>
  );
}
