'use client';

import type { AnalyticsResponse } from '@trace-id/signals/api';
import { ChevronDown, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, Input, PageHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { StatStrip } from '@/components/domain';
import { cn } from '@/lib/cn';
import { num, pct } from '@/lib/format';
import { RANGES, useProject } from '@/lib/project-context';
import { SIGNALS, type SignalGroup } from '@/lib/signals';
import { useApi } from '@/lib/use-api';

const GROUPS: { id: SignalGroup; hint: string }[] = [
  { id: 'Automation', hint: 'Scripts, bots and AI agents driving the page' },
  { id: 'Network', hint: 'Where the request comes from' },
  { id: 'Device', hint: 'What the browser or phone reveals about itself' },
  { id: 'Account', hint: 'How accounts and devices relate' },
  { id: 'Request', hint: 'Whether the request itself was altered or replayed' },
];

export default function SignalsPage() {
  const { project, range, setRange } = useProject();
  const base = `/projects/${project.id}`;
  const a = useApi<AnalyticsResponse>(`/v1/projects/${project.id}/analytics?days=${range}`);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => new Map((a.data?.signals ?? []).map((s) => [s.id, s])), [a.data]);
  const total = a.data?.totals.events ?? 0;
  const needle = q.trim().toLowerCase();
  const maxEvents = Math.max(1, ...(a.data?.signals ?? []).map((s) => s.events));
  const seen = a.data?.signals.length ?? 0;
  const top = a.data?.signals[0];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Signals"
        description="Everything Trace checks, what it means, and how often it fires in your traffic. Open a row for the explanation and when it can be a false alarm."
        actions={<Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.days, label: r.label }))} />}
      />
      <StatStrip
        items={[
          { label: 'Signals checked', value: SIGNALS.length, hint: 'On every identify call' },
          { label: 'Fired in this window', value: a.data ? seen : '-', hint: a.data ? `${SIGNALS.length - seen} never fired` : undefined },
          { label: 'Most common', value: top ? SIGNALS.find((s) => s.id === top.id)?.title ?? top.id : '-', hint: top ? `${num(top.events)} events` : undefined },
          { label: 'Events with a signal', value: a.data && total ? pct(Math.min(1, (a.data.totals.suspicious + a.data.totals.automated) / total), 0) : '-', hint: 'Suspicious or automated' },
        ]}
      />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input className="pl-9" placeholder="Search signals" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {GROUPS.map((g) => {
        const list = SIGNALS.filter((s) => s.group === g.id && (!needle || `${s.title} ${s.id} ${s.description}`.toLowerCase().includes(needle)))
          .sort((x, y) => (counts.get(y.id)?.events ?? 0) - (counts.get(x.id)?.events ?? 0));
        if (list.length === 0) return null;
        return (
          <section key={g.id}>
            <div className="mb-2 flex items-baseline gap-3 px-1">
              <h2 className="text-sm font-semibold tracking-tight">{g.id}</h2>
              <p className="text-xs text-ink-3">{g.hint}</p>
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {list.map((s) => {
                const c = counts.get(s.id);
                const isOpen = open === s.id;
                return (
                  <div key={s.id}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      className="flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-ink">{s.title}</span>
                        <span className="block truncate text-xs text-ink-3">{s.description}</span>
                      </span>
                      <span className="hidden w-48 shrink-0 md:block">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <span className="block h-full rounded-full bg-warn" style={{ width: `${c ? Math.max(3, (c.events / maxEvents) * 100) : 0}%` }} />
                        </span>
                      </span>
                      <span className="w-28 shrink-0 text-right">
                        {c ? (
                          <>
                            <span className="tnum block text-[13px] font-semibold text-ink">{num(c.events)}</span>
                            <span className="block text-[11px] text-ink-3">{pct(total ? c.events / total : 0)} of events</span>
                          </>
                        ) : (
                          <span className="text-xs text-ink-3">{a.data ? 'Not seen' : <Skeleton className="ml-auto h-4 w-14" />}</span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="grid gap-4 border-t border-line bg-surface-2/60 px-5 py-4 pl-[52px] text-[13px] leading-relaxed [animation:fade-in_.15s_ease-out] md:grid-cols-2">
                        <div>
                          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">What it detects</h4>
                          <p className="text-ink-2">{s.description}</p>
                          <p className="mt-2 font-mono text-[11px] text-ink-3">{s.id}</p>
                        </div>
                        <div>
                          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">When it is a false alarm</h4>
                          <p className="text-ink-2">{s.falsePositives}</p>
                          {c && <Link href={`${base}/events?signal=${s.id}`} className="mt-3 inline-block text-xs font-medium text-signal hover:underline">See {num(c.events)} events with this signal</Link>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
