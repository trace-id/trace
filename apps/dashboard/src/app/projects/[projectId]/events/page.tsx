'use client';

import type { EventSearchItem, EventSearchResponse } from '@tbdname/signals/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { EventTable } from '@/components/event-table';
import { ErrorBox, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useProject } from '@/lib/project-context';

const FILTERS = ['linkedId', 'visitorId', 'minScore', 'from', 'to'] as const;

function EventsSearch() {
  const { project } = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])),
  );
  const [events, setEvents] = useState<EventSearchItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = params.toString();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<EventSearchResponse>(`/v1/projects/${project.id}/events?limit=50${query ? `&${query}` : ''}`)
      .then((r) => {
        if (cancelled) return;
        setEvents(r.events);
        setCursor(r.nextCursor);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project.id, query]);

  async function more() {
    if (!cursor) return;
    try {
      const r = await api<EventSearchResponse>(
        `/v1/projects/${project.id}/events?limit=50&cursor=${encodeURIComponent(cursor)}${query ? `&${query}` : ''}`,
      );
      setEvents((prev) => [...prev, ...r.events]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const k of FILTERS) {
      const v = form[k]?.trim();
      if (!v) continue;
      next.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
    }
    router.push(`/projects/${project.id}/events${next.size ? `?${next}` : ''}`);
  }

  const field = (k: (typeof FILTERS)[number], label: string, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        value={type === 'datetime-local' && form[k] ? form[k].slice(0, 16) : (form[k] ?? '')}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <>
      <h1>Events</h1>
      <form className="panel row" onSubmit={apply} style={{ alignItems: 'flex-end' }}>
        {field('linkedId', 'Linked id')}
        {field('visitorId', 'Visitor id')}
        {field('minScore', 'Min score', 'number')}
        {field('from', 'From', 'datetime-local')}
        {field('to', 'To', 'datetime-local')}
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      <ErrorBox message={error} />
      <div className="panel">
        {loading ? <Loading /> : <EventTable projectId={project.id} events={events} />}
        {cursor && !loading && (
          <button onClick={more} style={{ marginTop: 12 }}>
            Load more
          </button>
        )}
      </div>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventsSearch />
    </Suspense>
  );
}
