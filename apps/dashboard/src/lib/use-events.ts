'use client';

import type { EventSearchItem, EventSearchResponse } from '@trace-id/signals/api';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

/** Loads up to `maxPages` pages (50 each) of events matching `query`, newest first, so a detail page can summarise them. */
export function useEvents(projectId: string, query: string, maxPages = 4) {
  const [events, setEvents] = useState<EventSearchItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    (async () => {
      const all: EventSearchItem[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < maxPages; i++) {
        const r: EventSearchResponse = await api<EventSearchResponse>(
          `/v1/projects/${projectId}/events?limit=50&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        all.push(...r.events);
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      if (!cancelled) {
        setEvents(all);
        setTruncated(cursor !== null);
      }
    })().catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId, query, maxPages]);

  return { events, truncated, error };
}

export interface EventSummary {
  total: number;
  maxScore: number;
  avgScore: number;
  countries: [string, number][];
  ips: [string, number][];
  visitors: [string, number][];
  accounts: [string, number][];
  signals: [string, number][];
  devices: [string, number][];
  firstAt: string | null;
  lastAt: string | null;
}

function tally(values: (string | null | undefined)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function summarise(events: EventSearchItem[]): EventSummary {
  const times = events.map((e) => e.createdAt).sort();
  return {
    total: events.length,
    maxScore: events.reduce((m, e) => Math.max(m, e.suspectScore), 0),
    avgScore: events.length ? events.reduce((s, e) => s + e.suspectScore, 0) / events.length : 0,
    countries: tally(events.map((e) => e.country)),
    ips: tally(events.map((e) => e.ip)),
    visitors: tally(events.map((e) => e.visitorId)),
    accounts: tally(events.map((e) => e.linkedId)),
    signals: tally(events.flatMap((e) => e.detected ?? [])),
    devices: tally(events.map((e) => (e.browser || e.os ? `${e.browser ?? 'Unknown'} · ${e.os ?? 'Unknown'}` : null))),
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
  };
}
