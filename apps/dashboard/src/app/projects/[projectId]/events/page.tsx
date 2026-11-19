'use client';

import type { EventSearchItem, EventSearchResponse } from '@trace-id/signals/api';
import { Bookmark, Columns3, Download, Filter, Flag, Rows3, RefreshCw, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Device, EntityLink, MatchBadge, Place, Score, SignalChips, When } from '@/components/domain';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Dialog, DialogClose, DialogContent } from '@/components/ui/overlay';
import { useRowNav } from '@/components/shell/shortcuts';
import { useToast } from '@/components/ui/toast';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Segmented, Select, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { shortId } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { SIGNALS, signalTitle } from '@/lib/signals';
import { useApi } from '@/lib/use-api';

const FILTERS = ['country', 'ip', 'minScore', 'maxScore', 'signal', 'matchKind', 'linkedId', 'visitorId', 'window'] as const;
type FilterKey = (typeof FILTERS)[number];

const COLUMNS = [
  { id: 'visitor', label: 'Visitor' },
  { id: 'account', label: 'Account' },
  { id: 'location', label: 'Location' },
  { id: 'device', label: 'Device' },
  { id: 'signals', label: 'Signals' },
  { id: 'identified', label: 'Identified' },
] as const;

const WINDOWS: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

function EventsInner() {
  const { project } = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/projects/${project.id}`;
  const [live, setLive] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const toast = useToast();
  const [moreFilters, setMoreFilters] = useState(false);
  const [cols, setCols] = useState<Record<string, boolean>>(() => Object.fromEntries(COLUMNS.map((c) => [c.id, true])));
  const [dense, setDense] = useState(false);
  const [views, setViews] = useState<{ name: string; search: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const viewsKey = `trace-events-views:${project.id}`;

  useEffect(() => {
    try {
      const c = localStorage.getItem('trace-events-cols');
      if (c) setCols((cur) => ({ ...cur, ...(JSON.parse(c) as Record<string, boolean>) }));
      setDense(localStorage.getItem('trace-events-dense') === '1');
      const v = localStorage.getItem(viewsKey);
      if (v) setViews(JSON.parse(v) as { name: string; search: string }[]);
    } catch {
      /* storage blocked or corrupt: defaults */
    }
  }, [viewsKey]);

  function persist(key: string, value: unknown) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  const active = useMemo(() => {
    const out: Partial<Record<FilterKey, string>> = {};
    for (const k of FILTERS) {
      const v = params.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [params]);

  useEffect(() => setDraft(Object.fromEntries(Object.entries(active))), [active]);

  const set = useCallback(
    (patch: Partial<Record<FilterKey, string | null>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${base}/events${next.size ? `?${next}` : ''}`, { scroll: false });
    },
    [params, router, base],
  );

  const query = useMemo(() => {
    const q = new URLSearchParams({ limit: '50' });
    for (const [k, v] of Object.entries(active)) {
      if (k === 'window') q.set('from', new Date(Date.now() - (WINDOWS[v] ?? 0)).toISOString());
      else q.set(k, v);
    }
    return q.toString();
    // `window` is relative to now, so it is recomputed with each filter change and each live refresh.
  }, [active]);

  const first = useApi<EventSearchResponse>(`/v1/projects/${project.id}/events?${query}`, { intervalMs: live ? 5000 : undefined });
  const [extra, setExtra] = useState<EventSearchItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExtra([]);
    setCursor(first.data?.nextCursor ?? null);
    if (!first.data) return;
    const incoming = first.data.events.filter((e) => !seen.current.has(e.eventId)).map((e) => e.eventId);
    if (seen.current.size > 0 && incoming.length > 0) {
      setFresh(new Set(incoming));
      setTimeout(() => setFresh(new Set()), 2500);
    }
    for (const e of first.data.events) seen.current.add(e.eventId);
  }, [first.data]);

  useEffect(() => {
    seen.current = new Set();
  }, [query]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await api<EventSearchResponse>(`/v1/projects/${project.id}/events?${query}&cursor=${encodeURIComponent(cursor)}`);
      setExtra((e) => [...e, ...r.events]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  }

  const events = [...(first.data?.events ?? []), ...extra];
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const toggleRow = useCallback((i: number) => {
    const id = eventsRef.current[i]?.eventId;
    if (!id) return;
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const openRow = useCallback((i: number) => {
    const id = eventsRef.current[i]?.eventId;
    if (id) router.push(`${base}/events/${id}`);
  }, [router, base]);
  const [cursorRow] = useRowNav(events.length, openRow, toggleRow);

  function saveView() {
    const name = window.prompt('Name this view', 'My view');
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, search: params.toString() }];
    setViews(next);
    persist(viewsKey, next);
    toast({ tone: 'ok', title: 'View saved', description: name });
  }

  async function labelSelected(fraud: boolean) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(labelName)) {
      toast({ tone: 'error', title: 'Invalid fraud type', description: 'Lowercase letters, digits and _, starting with a letter.' });
      return;
    }
    setLabelBusy(true);
    let done = 0;
    try {
      for (const id of selected) {
        await api(`/v1/projects/${project.id}/events/${id}/labels/${labelName}`, { method: 'PUT', body: { fraud } });
        done++;
      }
      toast({ tone: 'ok', title: `Labelled ${done} event${done === 1 ? '' : 's'}`, description: `${fraud ? 'Fraud' : 'Not fraud'}: ${labelName}` });
      setSelected(new Set());
      setLabelOpen(false);
    } catch (e) {
      toast({ tone: 'error', title: `Stopped after ${done} of ${selected.size}`, description: errorMessage(e) });
    } finally {
      setLabelBusy(false);
    }
  }
  const activeEntries = Object.entries(active);

  function exportCsv() {
    const head = ['eventId', 'createdAt', 'visitorId', 'linkedId', 'score', 'matchKind', 'country', 'ip', 'browser', 'os', 'signals'];
    const lines = events.map((e) =>
      [e.eventId, e.createdAt, e.visitorId, e.linkedId ?? '', e.suspectScore, e.matchKind, e.country ?? '', e.ip ?? '', e.browser ?? '', e.os ?? '', (e.detected ?? []).join('|')]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    set({
      ip: draft.ip?.trim() || null,
      linkedId: draft.linkedId?.trim() || null,
      visitorId: draft.visitorId?.trim() || null,
      country: draft.country?.trim().toUpperCase() || null,
    });
  }

  return (
    <>
      <PageHeader
        title="Events"
        description="Every identify call, newest first. Filter by anything Trace recorded."
        actions={
          <>
            <Dropdown>
              <DropdownTrigger asChild><Button variant="outline"><Bookmark className="size-3.5" /> Views</Button></DropdownTrigger>
              <DropdownContent className="w-64">
                <DropdownLabel>Saved views</DropdownLabel>
                {views.length === 0 && <p className="px-2.5 pb-2 text-xs text-ink-3">Save the current filters to come back to them.</p>}
                {views.map((v) => (
                  <DropdownItem key={v.name} onSelect={() => router.replace(`${base}/events${v.search ? `?${v.search}` : ''}`)}>
                    <span className="flex-1 truncate">{v.name}</span>
                    <button aria-label={`Delete ${v.name}`} className="cursor-pointer text-ink-3 hover:text-bad" onClick={(e) => { e.stopPropagation(); const next = views.filter((x) => x.name !== v.name); setViews(next); persist(viewsKey, next); }}><Trash2 className="size-3.5" /></button>
                  </DropdownItem>
                ))}
                <DropdownSeparator />
                <DropdownItem onSelect={saveView}>Save current filters…</DropdownItem>
              </DropdownContent>
            </Dropdown>
            <Dropdown>
              <DropdownTrigger asChild><Button variant="outline" aria-label="Table options"><Columns3 className="size-3.5" /> Columns</Button></DropdownTrigger>
              <DropdownContent className="w-52">
                <DropdownLabel>Show columns</DropdownLabel>
                {COLUMNS.map((c) => (
                  <DropdownItem key={c.id} onSelect={(e) => { e.preventDefault(); const next = { ...cols, [c.id]: !cols[c.id] }; setCols(next); persist('trace-events-cols', next); }}>
                    <input type="checkbox" readOnly checked={cols[c.id] ?? true} className="size-3.5 accent-[var(--signal)]" /> {c.label}
                  </DropdownItem>
                ))}
                <DropdownSeparator />
                <DropdownItem onSelect={(e) => { e.preventDefault(); setDense((d) => { persist('trace-events-dense', d ? '0' : '1'); return !d; }); }}>
                  <Rows3 className="size-3.5 text-ink-3" /> {dense ? 'Comfortable rows' : 'Compact rows'}
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
            <Button variant={live ? 'signal' : 'outline'} onClick={() => setLive((l) => !l)} aria-pressed={live}>
              {live ? <span className="live-dot" /> : <RefreshCw className="size-3.5" />} {live ? 'Live' : 'Go live'}
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={events.length === 0}>
              <Download className="size-3.5" /> Export CSV
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Segmented
            value={active.minScore === '70' ? 'high' : active.minScore === '30' && active.maxScore === '69' ? 'mid' : active.maxScore === '29' ? 'low' : 'all'}
            onChange={(v) => set(v === 'high' ? { minScore: '70', maxScore: null } : v === 'mid' ? { minScore: '30', maxScore: '69' } : v === 'low' ? { minScore: null, maxScore: '29' } : { minScore: null, maxScore: null })}
            options={[{ value: 'all', label: 'All' }, { value: 'high', label: 'High risk' }, { value: 'mid', label: 'Medium' }, { value: 'low', label: 'Low' }]}
          />
          <Select aria-label="Time window" className="w-40" value={active.window ?? ''} onChange={(e) => set({ window: e.target.value || null })}>
            <option value="">Any time</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
          <Select aria-label="Signal" className="w-52" value={active.signal ?? ''} onChange={(e) => set({ signal: e.target.value || null })}>
            <option value="">Any signal</option>
            {SIGNALS.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </Select>
          <Select aria-label="Identification" className="w-48" value={active.matchKind ?? ''} onChange={(e) => set({ matchKind: e.target.value || null })}>
            <option value="">Any identification</option>
            <option value="new">New device</option>
            <option value="token">Returning (token)</option>
            <option value="match">Matched by signals</option>
            <option value="conflict">Conflict</option>
          </Select>
          <Button variant="ghost" className="ml-auto" onClick={() => setMoreFilters((m) => !m)} aria-expanded={moreFilters}>
            <Filter className="size-3.5" /> {moreFilters ? 'Fewer filters' : 'More filters'}
          </Button>
        </div>
        {(moreFilters || active.ip || active.linkedId || active.visitorId || active.country) && (
          <form onSubmit={apply} className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,1fr)_auto]">
            <Input placeholder="IP address" value={draft.ip ?? ''} onChange={(e) => setDraft({ ...draft, ip: e.target.value })} />
            <Input placeholder="Account (linked id)" value={draft.linkedId ?? ''} onChange={(e) => setDraft({ ...draft, linkedId: e.target.value })} />
            <Input placeholder="Visitor id" value={draft.visitorId ?? ''} onChange={(e) => setDraft({ ...draft, visitorId: e.target.value })} />
            <Input placeholder="Country (US)" maxLength={2} value={draft.country ?? ''} onChange={(e) => setDraft({ ...draft, country: e.target.value })} className="uppercase" />
            <Button type="submit" variant="primary">Apply</Button>
          </form>
        )}
        {activeEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
            <span className="text-xs text-ink-3">Filters</span>
            {activeEntries.map(([k, v]) => (
              <Badge key={k} tone="signal" className="gap-1.5 py-1 pl-2.5 pr-1.5">
                {k === 'signal' ? `Signal: ${signalTitle(v as string)}` : `${k}: ${v}`}
                <button aria-label={`Remove ${k} filter`} onClick={() => set({ [k]: null, ...(k === 'minScore' ? { maxScore: null } : {}) })} className="cursor-pointer rounded-full p-0.5 hover:bg-signal/15">
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <button onClick={() => router.replace(`${base}/events`)} className="cursor-pointer text-xs text-ink-3 hover:text-ink">Clear all</button>
          </div>
        )}
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-signal/40 bg-signal-soft px-4 py-2.5 text-[13px] text-signal-ink shadow-card [animation:pop-in_.15s_ease-out]">
          <b>{selected.size} selected</b>
          <span className="text-signal-ink/70">Press x on a highlighted row to select it</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" variant="danger" onClick={() => setLabelOpen(true)}><Flag className="size-3.5" /> Label…</Button>
          </div>
        </div>
      )}
      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent title={`Label ${selected.size} event${selected.size === 1 ? '' : 's'}`} description="Labels train the fraud models of this project. Pick a fraud type, then say whether these events were that kind of fraud.">
          <Input value={labelName} onChange={(e) => setLabelName(e.target.value.toLowerCase())} placeholder="account_takeover" maxLength={32} className="font-mono text-xs" autoFocus />
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="outline" disabled={labelBusy || !labelName} onClick={() => labelSelected(false)}>Not fraud</Button>
            <Button variant="danger" disabled={labelBusy || !labelName} onClick={() => labelSelected(true)}>{labelBusy ? 'Labelling…' : 'Mark as fraud'}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <ErrorBanner message={error ?? first.error} />
      <Card className="overflow-hidden">
        {!first.data && first.loading ? (
          <div className="grid gap-3 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : events.length === 0 ? (
          <EmptyState title="No events match" description={activeEntries.length ? 'Loosen a filter, or widen the time window.' : 'Events appear here as soon as your site calls identify.'} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-10"><input type="checkbox" aria-label="Select all" className="size-3.5 accent-[var(--signal)]" checked={events.length > 0 && selected.size === events.length} onChange={(e) => setSelected(e.target.checked ? new Set(events.map((x) => x.eventId)) : new Set())} /></Th>
                  <Th>Score</Th>
                  <Th>Time</Th>
                  {cols.visitor && <Th>Visitor</Th>}
                  {cols.account && <Th>Account</Th>}
                  {cols.location && <Th>Location</Th>}
                  {cols.device && <Th>Device</Th>}
                  {cols.signals && <Th>Signals</Th>}
                  {cols.identified && <Th>Identified</Th>}
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <Tr key={e.eventId} interactive onClick={() => router.push(`${base}/events/${e.eventId}`)} className={cn(fresh.has(e.eventId) && 'bg-signal-soft', selected.has(e.eventId) && 'bg-signal-soft/60', cursorRow === i && 'outline outline-2 -outline-offset-2 outline-signal/60', dense && '[&>td]:py-1.5')}>
                    <Td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" aria-label="Select event" className="size-3.5 accent-[var(--signal)]" checked={selected.has(e.eventId)} onChange={() => toggleRow(i)} /></Td>
                    <Td><Score value={e.suspectScore} /></Td>
                    <Td><When iso={e.createdAt} /></Td>
                    {cols.visitor && <Td><EntityLink href={`${base}/visitors/${e.visitorId}`} mono>{shortId(e.visitorId, 10)}</EntityLink></Td>}
                    {cols.account && <Td>{e.linkedId ? <EntityLink href={`${base}/accounts/${encodeURIComponent(e.linkedId)}`} mono>{shortId(e.linkedId, 14)}</EntityLink> : <span className="text-ink-3">-</span>}</Td>}
                    {cols.location && <Td><div className="grid"><Place code={e.country} />{!dense && e.ip && <span className="font-mono text-[11px] text-ink-3">{e.ip}</span>}</div></Td>}
                    {cols.device && <Td><Device browser={e.browser} os={e.os} /></Td>}
                    {cols.signals && <Td><SignalChips ids={e.detected ?? []} max={2} /></Td>}
                    {cols.identified && <Td><MatchBadge kind={e.matchKind} /></Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-3">
              <span>{events.length} events loaded{live && ' · refreshing every 5s'}</span>
              {cursor && (
                <Button variant="outline" size="sm" onClick={loadMore} disabled={more}>
                  {more ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense>
      <EventsInner />
    </Suspense>
  );
}
