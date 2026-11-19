'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { Tip } from '@/components/ui/overlay';
import { DeviceCell, Flag } from '@/components/logos';
import { Sparkline } from '@/components/charts/charts';
import { cn } from '@/lib/cn';
import { countryName } from '@/lib/country';
import { scoreLabel, scoreTone, timeAgo, formatDateTime } from '@/lib/format';
import { signalMeta } from '@/lib/signals';

const TONE_BG = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' } as const;
const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Suspect score as a number with a small bar, coloured by risk band. */
export function Score({ value, compact }: { value: number; compact?: boolean }) {
  const tone = scoreTone(value);
  return (
    <Tip label={`${scoreLabel(value)} risk · ${value}/100`}>
      <span className="inline-flex items-center gap-2">
        <span className={cn('tnum w-6 text-right text-[13px] font-semibold', TONE_TEXT[tone])}>{value}</span>
        {!compact && (
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
            <span className={cn('block h-full rounded-full', TONE_BG[tone])} style={{ width: `${Math.max(4, value)}%` }} />
          </span>
        )}
      </span>
    </Tip>
  );
}

export function RiskBadge({ value }: { value: number }) {
  const tone = scoreTone(value);
  return <Badge tone={tone}>{scoreLabel(value)}</Badge>;
}

const MATCH_LABEL: Record<string, string> = { new: 'New', token: 'Returning', match: 'Matched', conflict: 'Conflict' };
const MATCH_TONE: Record<string, 'signal' | 'neutral' | 'info' | 'warn'> = { new: 'signal', token: 'neutral', match: 'info', conflict: 'warn' };

export function MatchBadge({ kind }: { kind: string }) {
  return <Badge tone={MATCH_TONE[kind] ?? 'neutral'}>{MATCH_LABEL[kind] ?? kind}</Badge>;
}

export function SignalChip({ id }: { id: string }) {
  const m = signalMeta(id);
  return (
    <Tip label={m.description || m.title}>
      <span className="inline-flex cursor-default items-center rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{m.title}</span>
    </Tip>
  );
}

export function SignalChips({ ids, max = 3 }: { ids: string[]; max?: number }) {
  if (ids.length === 0) return <span className="text-xs text-ink-3">None</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {ids.slice(0, max).map((id) => (
        <SignalChip key={id} id={id} />
      ))}
      {ids.length > max && <span className="text-[11px] text-ink-3">+{ids.length - max}</span>}
    </span>
  );
}

/** A real flag for a country code (kept under the old name so callers need no change). */
export function CountryChip({ code }: { code: string | null | undefined }) {
  return <Flag code={code} />;
}

export function Place({ code }: { code: string | null | undefined }) {
  if (!code) return <span className="text-ink-3">Unknown</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <CountryChip code={code} />
      <span>{countryName(code)}</span>
    </span>
  );
}

export function When({ iso }: { iso: string }) {
  return (
    <Tip label={formatDateTime(iso)}>
      <time dateTime={iso} className="cursor-default whitespace-nowrap text-ink-2">
        {timeAgo(iso)}
      </time>
    </Tip>
  );
}

export function Device({ browser, os, deviceType }: { browser?: string | null; os?: string | null; deviceType?: string | null }) {
  return <DeviceCell browser={browser} os={os} deviceType={deviceType} />;
}

export function EntityLink({ href, children, mono }: { href: string; children: ReactNode; mono?: boolean }) {
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={cn('text-ink underline-offset-2 hover:text-signal hover:underline', mono && 'font-mono text-xs')}>
      {children}
    </Link>
  );
}

/** Animates a number from its previous value to the new one; respects reduced motion. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from.current === value) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - t) ** 3;
      setShown(a + (value - a) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

/** One headline figure with a change indicator against the previous period. */
export function StatCard({
  label,
  value,
  change,
  invert,
  hint,
  spark,
  sparkColor,
  loading,
  count,
}: {
  label: string;
  value: ReactNode;
  /** Animate to this number using `fmt` (falls back to `value` when absent). */
  count?: { to: number; fmt: (n: number) => string };
  /** Signed ratio against the previous window; null when there is nothing to compare. */
  change?: number | null;
  /** When up is bad (suspicious events), colour the change red. */
  invert?: boolean;
  hint?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  loading?: boolean;
}) {
  const up = (change ?? 0) > 0.0005;
  const down = (change ?? 0) < -0.0005;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink-3">{label}</span>
        {spark && <Sparkline values={spark} color={sparkColor} />}
      </div>
      {loading ? (
        <div className="skeleton mt-2 h-8 w-24" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="tnum text-[28px] font-semibold leading-8 tracking-tight text-ink">{count ? <CountUp value={count.to} format={count.fmt} /> : value}</span>
          {change !== undefined && (
            <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', change === null ? 'text-ink-3' : good ? 'text-ok' : bad ? 'text-bad' : 'text-ink-3')}>
              {change === null ? (
                'new'
              ) : (
                <>
                  {up ? <ArrowUpRight className="size-3.5" /> : down ? <ArrowDownRight className="size-3.5" /> : <Minus className="size-3.5" />}
                  {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
                </>
              )}
            </span>
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

/** Label and value row for detail panels. */
export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-ink-3">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right text-[13px] text-ink', mono && 'font-mono text-xs')}>{children}</dd>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="py-1">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One card with several headline figures divided by hairlines (detail pages). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }[] }) {
  return (
    <Card className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 [&>*]:sm:border-l [&>*]:sm:border-line [&>*:first-child]:border-l-0">
      {items.map((it) => (
        <div key={it.label} className="px-5 py-4">
          <p className="text-xs font-medium text-ink-3">{it.label}</p>
          <p className={cn('tnum mt-1 text-[26px] font-semibold leading-8 tracking-tight', it.tone ? TONE_TEXT[it.tone] : 'text-ink')}>{it.value}</p>
          {it.hint && <p className="mt-0.5 text-xs text-ink-3">{it.hint}</p>}
        </div>
      ))}
    </Card>
  );
}

/** Identity header for a visitor, account or event: glyph, title, badges and a row of facts. */
export function EntityHero({
  icon,
  kind,
  title,
  badges,
  facts,
  actions,
  aside,
}: {
  icon: ReactNode;
  kind: string;
  title: ReactNode;
  badges?: ReactNode;
  facts: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-5 p-6">
        {aside}
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-signal-soft text-signal-ink [&>svg]:size-6">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-3">{kind}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 break-all text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {badges}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <dl className="grid divide-x divide-line border-t border-line bg-surface-2/60 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line sm:[&>*:nth-child(n+3)]:border-t-0">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0 px-5 py-3.5">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{f.label}</dt>
            <dd className="mt-1 truncate text-[13px] font-medium text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
