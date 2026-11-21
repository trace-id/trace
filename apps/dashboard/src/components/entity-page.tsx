'use client';

import type { EventResponse, EventSearchItem } from '@trace-id/signals/api';
import { Ban, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { Sparkline } from '@/components/charts/charts';
import { MatchBadge, Place, SignalChips } from '@/components/domain';
import { BrowserLogo, OsLogo } from '@/components/logos';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { scoreLabel, scoreTone } from '@/lib/format';
import { signalTitle } from '@/lib/signals';

const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;
const TONE_BG = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' } as const;

/**
 * A score as a tinted tile: the number, its risk word, and a meter split into the low, medium and high bands with a
 * marker where the score sits. Kept as ScoreRing for the pages that already use it.
 */
export function ScoreRing({ value, label }: { value: number | null; size?: number; label?: string }) {
  const tone = value === null ? null : scoreTone(value);
  const soft = tone === 'bad' ? 'bg-bad-soft' : tone === 'warn' ? 'bg-warn-soft' : tone === 'ok' ? 'bg-ok-soft' : 'bg-surface-2';
  return (
    <div className={cn('w-[152px] shrink-0 rounded-2xl border border-line p-3.5', soft)} role="img" aria-label={value === null ? 'No score yet' : `Score ${value} of 100, ${scoreLabel(value)} risk`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{label ?? 'Score'}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={cn('tnum text-[40px] font-semibold leading-none tracking-tight', tone ? TONE_TEXT[tone] : 'text-ink-3')}>{value ?? '-'}</span>
        <span className="text-xs text-ink-3">/ 100</span>
      </p>
      <div className="relative mt-3 flex h-1.5 gap-0.5" aria-hidden>
        <span className="h-full flex-[30] rounded-l-full bg-ok/35" />
        <span className="h-full flex-[40] bg-warn/35" />
        <span className="h-full flex-[30] rounded-r-full bg-bad/35" />
        {value !== null && (
          <span className={cn('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm', tone ? TONE_BG[tone] : '')} style={{ left: `${Math.min(100, Math.max(0, value))}%` }} />
        )}
      </div>
      <p className={cn('mt-2.5 text-xs font-semibold', tone ? TONE_TEXT[tone] : 'text-ink-3')}>{value === null ? 'No data yet' : `${scoreLabel(value)} risk`}</p>
    </div>
  );
}

/**
 * The top of a visitor or account page: the peak score as a ring, who this is, a sentence that sums it up, the
 * actions, and a row of facts underneath.
 */
export function EntityHeader({
  kind,
  icon,
  title,
  badges,
  summary,
  ring,
  actions,
  facts,
}: {
  kind: string;
  icon: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  summary?: ReactNode;
  ring: ReactNode;
  actions?: ReactNode;
  facts: { label: string; value: ReactNode }[];
}) {
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-signal-soft/70 to-transparent" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4 p-6">
        {ring}
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-3">
            <span className="grid size-6 place-items-center rounded-lg bg-signal-soft text-signal-ink [&>svg]:size-3.5">{icon}</span>
            {kind}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 break-all text-[22px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
            {badges}
          </div>
          {summary && <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{summary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div>}
      </div>
      <dl className="relative grid grid-cols-2 border-t border-line bg-surface-2/50 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 border-b border-r border-line px-5 py-3 last:border-r-0 xl:border-b-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{f.label}</dt>
            <dd className="mt-1 truncate text-[13px] font-medium text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export interface KpiItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ok' | 'warn' | 'bad';
  icon?: ReactNode;
  spark?: number[];
  sparkColor?: string;
}

/** A row of figure cards, each optionally with a small trend line. */
export function KpiGrid({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
      {items.map((it) => (
        <Card key={it.label} className="relative overflow-hidden p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3 [&>svg]:size-3.5">{it.icon}{it.label}</p>
            {it.tone && <span className={cn('size-1.5 rounded-full', TONE_BG[it.tone])} aria-hidden />}
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className={cn('tnum text-[28px] font-semibold leading-8 tracking-tight', it.tone ? TONE_TEXT[it.tone] : 'text-ink')}>{it.value}</p>
            {it.spark && it.spark.length > 1 && <Sparkline values={it.spark} color={it.sparkColor ?? 'var(--signal)'} width={84} height={30} fill />}
          </div>
          {it.hint && <p className="mt-1 truncate text-xs text-ink-3">{it.hint}</p>}
        </Card>
      ))}
    </div>
  );
}

/** Events per day, oldest first, for the last `days` days ending at the newest event. Feeds the sparklines. */
export function dailySeries(events: EventSearchItem[] | null, days = 14): { events: number[]; peak: number[] } {
  if (!events || events.length === 0) return { events: [], peak: [] };
  const end = new Date(Math.max(...events.map((e) => new Date(e.createdAt).getTime())));
  end.setUTCHours(0, 0, 0, 0);
  const counts = new Array<number>(days).fill(0);
  const peak = new Array<number>(days).fill(0);
  for (const e of events) {
    const back = Math.floor((end.getTime() - new Date(e.createdAt).setUTCHours(0, 0, 0, 0)) / 86_400_000);
    if (back < 0 || back >= days) continue;
    const i = days - 1 - back;
    counts[i] = (counts[i] ?? 0) + 1;
    peak[i] = Math.max(peak[i] ?? 0, e.suspectScore);
  }
  return { events: counts, peak };
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const clock = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Events grouped by day, newest first, each as a row with its score, place, device and signals. */
export function DayTimeline({ events, basePath, empty = 'No events match.', compact = false }: { events: EventSearchItem[]; basePath: string; empty?: string; compact?: boolean }) {
  const router = useRouter();
  const groups = useMemo(() => {
    const out: { label: string; items: EventSearchItem[] }[] = [];
    for (const e of events) {
      const label = dayLabel(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [events]);
  if (events.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="px-2 pb-3">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="sticky top-14 z-[1] flex items-center gap-3 bg-surface/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 backdrop-blur">
            {g.label}
            <span className="h-px flex-1 bg-line" />
            <span className="tnum font-medium normal-case tracking-normal">{g.items.length} event{g.items.length === 1 ? '' : 's'}</span>
          </h3>
          <ol>
            {g.items.map((e) => {
              const tone = scoreTone(e.suspectScore);
              return (
                <li key={e.eventId}>
                  <button type="button" onClick={() => router.push(`${basePath}/events/${e.eventId}`)} className={cn('group grid w-full cursor-pointer items-center gap-x-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2', compact ? 'grid-cols-[36px_minmax(0,1fr)_auto]' : 'grid-cols-[64px_auto_minmax(0,1fr)_auto]')}>
                    {!compact && <span className="tnum whitespace-nowrap text-xs text-ink-3">{clock(e.createdAt)}</span>}
                    <span className={cn('tnum grid size-9 place-items-center rounded-xl text-[13px] font-semibold', tone === 'bad' ? 'bg-bad-soft text-bad' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')} title={`${scoreLabel(e.suspectScore)} risk`}>{e.suspectScore}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-ink">
                        <span className="inline-flex items-center gap-1.5 text-ink"><BrowserLogo name={e.browser ?? ''} size={14} />{[e.browser, e.os].filter(Boolean).join(' · ') || 'Unknown device'}{e.os && <OsLogo name={e.os} size={12} />}</span>
                        {e.country && <Place code={e.country} />}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                        {e.ip && <span className="font-mono">{e.ip}</span>}
                        {e.linkedId && <span className="max-w-full truncate">account <span className="font-mono">{e.linkedId}</span></span>}
                        {(e.detected?.length ?? 0) > 0 && <SignalChips ids={e.detected ?? []} max={compact ? 1 : 3} />}
                      </span>
                    </span>
                    {compact ? <span className="tnum self-start pt-1 text-[11px] text-ink-3">{clock(e.createdAt)}</span> : <MatchBadge kind={e.matchKind} />}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** What decided the latest event's score: the reasons with their weight, and any list entry that overrode it. */
export function VerdictCard({ event, basePath }: { event: EventResponse | null; basePath: string }) {
  if (!event) return <Card className="p-5"><div className="skeleton h-40" /></Card>;
  const tone = scoreTone(event.suspectScore);
  const max = Math.max(1, ...event.reasons.map((r) => r.contribution));
  return (
    <Card>
      <CardHeader title="Latest verdict" description="Why the most recent event scored what it did" action={<Badge tone={tone}>{scoreLabel(event.suspectScore)}</Badge>} />
      <div className="grid gap-3 px-5 pb-5">
        {event.list && (
          <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs', event.list.action === 'block' ? 'border-bad/30 bg-bad-soft text-bad' : 'border-ok/30 bg-ok-soft text-ok')}>
            {event.list.action === 'block' ? <Ban className="mt-0.5 size-3.5 shrink-0" /> : <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />}
            <span>{event.list.action === 'block' ? 'Blocked' : 'Allowed'} by your list ({event.list.value}). The signals alone gave {event.list.scoreBefore}.</span>
          </div>
        )}
        {event.reasons.length === 0 ? (
          <p className="text-[13px] text-ink-3">No signal fired on this event.</p>
        ) : (
          <ul className="grid gap-2.5">
            {event.reasons.slice(0, 6).map((r) => (
              <li key={r.signal} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="truncate text-ink">{signalTitle(r.signal)}</span>
                <span className="tnum font-semibold text-ink-2">+{r.contribution}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><span className={cn('block h-full rounded-full', TONE_BG[tone])} style={{ width: `${(r.contribution / max) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
        <Link href={`${basePath}/events/${event.eventId}`} className="text-[13px] font-medium text-signal-ink hover:underline">Open this event</Link>
      </div>
    </Card>
  );
}
