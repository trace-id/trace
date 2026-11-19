'use client';

import type { EventSearchResponse } from '@trace-id/signals/api';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignalChip } from '@/components/domain';
import { BrowserLogo, Flag, OsLogo } from '@/components/logos';
import { Card, CardHeader, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { scoreTone, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const DOT = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' } as const;
const TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** The latest identify calls, refreshed every few seconds; rows that just arrived flash briefly. */
export function LiveFeed({ projectId, base }: { projectId: string; base: string }) {
  const feed = useApi<EventSearchResponse>(`/v1/projects/${projectId}/events?limit=9`, { intervalMs: 6000 });
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);

  useEffect(() => {
    if (!feed.data) return;
    const incoming = feed.data.events.map((e) => e.eventId).filter((id) => !seen.current.has(id));
    if (seen.current.size > 0 && incoming.length) {
      setFresh(new Set(incoming));
      setTimeout(() => setFresh(new Set()), 2400);
    }
    feed.data.events.forEach((e) => seen.current.add(e.eventId));
  }, [feed.data]);

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Live activity <span className="live-dot" />
          </span>
        }
        description="Newest identify calls"
        action={<Link href={`${base}/events`} className="text-xs font-medium text-signal hover:underline">All events</Link>}
      />
      <ul className="flex-1 px-2 pb-2">
        {!feed.data
          ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="mx-3 my-2 h-8" />)
          : feed.data.events.map((e) => {
              const tone = scoreTone(e.suspectScore);
              return (
                <li key={e.eventId}>
                  <Link href={`${base}/events/${e.eventId}`} className={cn('flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface-2', fresh.has(e.eventId) && 'bg-signal-soft')}>
                    <span className={cn('tnum grid size-8 shrink-0 place-items-center rounded-lg text-[12px] font-semibold', tone === 'bad' ? 'bg-bad-soft' : tone === 'warn' ? 'bg-warn-soft' : 'bg-ok-soft', TEXT[tone])}>{e.suspectScore}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] text-ink">
                        <Flag code={e.country} />
                        <BrowserLogo name={e.browser ?? ''} size={15} />
                        <span className="truncate">{[e.browser, e.os].filter(Boolean).join(' · ') || 'Unknown device'}</span>
                        {e.os && <OsLogo name={e.os} size={13} />}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-3">{e.linkedId ?? e.ip ?? e.visitorId}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {e.detected?.[0] ? <SignalChip id={e.detected[0]} /> : <span className={cn('size-1.5 rounded-full', DOT[tone])} />}
                      <span className="text-[11px] text-ink-3">{timeAgo(e.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
      </ul>
    </Card>
  );
}
