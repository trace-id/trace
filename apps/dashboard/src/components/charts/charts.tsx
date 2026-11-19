'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';

/** Width of the element, tracked with a ResizeObserver so charts redraw crisply at any size. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((x) => n <= x) ?? 10;
  return step * pow;
}

/** Smooth line through the points that never overshoots between them (monotone cubic interpolation). */
export function smoothPath(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${(pts[i]![0] + h).toFixed(1)},${(pts[i]![1] + m[i]! * h).toFixed(1)} ${(pts[i + 1]![0] - h).toFixed(1)},${(pts[i + 1]![1] - m[i + 1]! * h).toFixed(1)} ${pts[i + 1]![0].toFixed(1)},${pts[i + 1]![1].toFixed(1)}`;
  }
  return d;
}

/* ---------- Area / line chart ---------- */

export interface Series {
  key: string;
  name: string;
  color: string;
  /** Fill under the line. */
  area?: boolean;
}

export interface AreaPoint {
  label: string;
  values: Record<string, number>;
}

export function AreaChart({
  data,
  series,
  height = 220,
  xLabel,
  className,
  grid = true,
}: {
  data: AreaPoint[];
  series: Series[];
  height?: number;
  xLabel?: (label: string) => string;
  className?: string;
  grid?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: grid ? 36 : 4, r: 8, t: 12, b: 26 };
  const w = Math.max(width, 120);
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const { max, xs, paths } = useMemo(() => {
    const m = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0))));
    const n = data.length;
    const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => pad.t + ih - (v / m) * ih;
    const p = series.map((s) => {
      const pts = data.map((d, i) => [x(i), y(d.values[s.key] ?? 0)] as const);
      const line = smoothPath(pts);
      const area = pts.length ? `${line} L${pts[pts.length - 1]![0].toFixed(1)},${pad.t + ih} L${pts[0]![0].toFixed(1)},${pad.t + ih} Z` : '';
      return { s, line, area };
    });
    return { max: m, xs: data.map((_, i) => x(i)), paths: p };
  }, [data, series, iw, ih, pad.l]);

  const ticks = [0, 0.5, 1].map((f) => ({ f, v: Math.round(max * f) }));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 80))));
  const active = hover !== null ? data[hover] : null;
  const uid = useMemo(() => Math.random().toString(36).slice(2, 7), []);

  return (
    <div ref={ref} className={cn('relative w-full', className)} style={{ height }}>
      {width > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label="Time series chart"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            let best = 0;
            let d = Infinity;
            xs.forEach((x, i) => {
              const dd = Math.abs(x - px);
              if (dd < d) {
                d = dd;
                best = i;
              }
            });
            setHover(best);
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {grid &&
            ticks.map((t) => {
              const y = pad.t + ih - t.f * ih;
              return (
                <g key={t.f}>
                  <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray={t.f === 0 ? undefined : '2 5'} />
                  <text x={pad.l - 8} y={y + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" className="tnum">
                    {t.v >= 1000 ? `${(t.v / 1000).toFixed(t.v % 1000 ? 1 : 0)}k` : t.v}
                  </text>
                </g>
              );
            })}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.label} x={xs[i]} y={height - 7} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="10.5" fill="var(--ink-3)">
                {xLabel ? xLabel(d.label) : d.label}
              </text>
            ) : null,
          )}
          {paths.map(({ s, line, area }) => (
            <g key={s.key}>
              {s.area && <path d={area} fill={`url(#g-${uid}-${s.key})`} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={pad.t + ih} stroke="var(--ink-3)" strokeOpacity="0.4" strokeDasharray="3 3" />
              {series.map((s) => {
                const v = data[hover]!.values[s.key] ?? 0;
                return <circle key={s.key} cx={xs[hover]} cy={pad.t + ih - (v / max) * ih} r="4.5" fill="var(--surface)" stroke={s.color} strokeWidth="2.25" />;
              })}
            </g>
          )}
        </svg>
      )}
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-xs shadow-pop backdrop-blur"
          style={{ left: Math.min(Math.max(xs[hover]! + 14, 8), Math.max(8, w - 190)) }}
        >
          <div className="mb-1.5 font-medium text-ink">{xLabel ? xLabel(active.label) : active.label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-5 py-0.5">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="tnum font-semibold text-ink">{num(active.values[s.key] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Clickable legend that toggles series. */
export function Legend({ series, hidden, onToggle }: { series: Series[]; hidden?: Set<string>; onToggle?: (key: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {series.map((s) => {
        const off = hidden?.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            disabled={!onToggle}
            aria-pressed={!off}
            onClick={() => onToggle?.(s.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              onToggle ? 'cursor-pointer hover:bg-surface-3' : 'cursor-default',
              off ? 'border-line text-ink-3' : 'border-line-strong text-ink-2',
            )}
          >
            <span className="size-2 rounded-full" style={{ background: off ? 'var(--line-strong)' : s.color }} />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Histogram (score distribution) ---------- */

export function Histogram({ values, colorFor, labels, height = 150 }: { values: number[]; colorFor: (i: number) => string; labels: string[]; height?: number }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className="w-full rounded-md transition-[filter,opacity] group-hover:brightness-110"
              style={{ height: `${Math.max(v > 0 ? 3 : 1.5, (v / max) * 100)}%`, background: colorFor(i), opacity: v === 0 ? 0.25 : 1 }}
            />
            <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] text-bg group-hover:block">
              {labels[i]}: {num(v)} ({total ? ((v / total) * 100).toFixed(1) : 0}%)
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {labels.map((l) => (
          <span key={l} className="flex-1 text-center text-[10px] text-ink-3">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Ranked bars ---------- */

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Secondary figure shown right of the value, e.g. suspicious count. */
  sub?: ReactNode;
  href?: string;
}

export function BarList({ rows, color = 'var(--signal)', empty = 'No data in this window', onSelect }: { rows: BarRow[]; color?: string; empty?: string; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="px-5 pb-6 pt-2 text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="grid gap-0.5 px-2 pb-3">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(r.key)}
            className={cn('relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2 text-left text-[13px]', onSelect && 'cursor-pointer hover:bg-surface-2')}
          >
            <span className="absolute inset-y-1.5 left-1 rounded-md opacity-[0.13]" style={{ width: `calc(${(r.value / max) * 100}% - 8px)`, background: color }} />
            <span className="relative z-[1] min-w-0 truncate text-ink">{r.label}</span>
            <span className="relative z-[1] flex shrink-0 items-center gap-3">
              {r.sub !== undefined && <span className="text-xs text-ink-3">{r.sub}</span>}
              <span className="tnum w-12 text-right font-semibold text-ink">{num(r.value)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Donut ---------- */

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, size = 150, center, thickness = 14, hideLegend }: { slices: Slice[]; size?: number; center?: ReactNode; thickness?: number; hideLegend?: boolean }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - thickness / 2 - 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {total > 0 &&
            slices.map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                  strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
      </div>
      {!hideLegend && <ul className="grid min-w-36 flex-1 gap-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2 text-ink-2">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum font-medium text-ink">
              {num(s.value)} <span className="font-normal text-ink-3">{total ? `${Math.round((s.value / total) * 100)}%` : ''}</span>
            </span>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/* ---------- Heatmap ---------- */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <div className="min-w-[380px]">
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-[3px] py-[1.5px]">
            <span className="w-7 shrink-0 text-[10px] text-ink-3">{DAYS[d]}</span>
            {row.map((v, h) => (
              <div
                key={h}
                title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00 UTC · ${num(v)} events`}
                className="h-[18px] flex-1 rounded-[4px]"
                style={{ background: v === 0 ? 'var(--surface-3)' : `color-mix(in srgb, var(--signal) ${Math.round(14 + (v / max) * 86)}%, var(--surface-3))` }}
              />
            ))}
          </div>
        ))}
        <div className="mt-1 flex gap-[3px] pl-8">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="flex-1 text-center text-[9px] text-ink-3">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Sparkline ---------- */

export function Sparkline({ values, color = 'var(--signal)', width = 96, height = 28, fill = false }: { values: number[]; color?: string; width?: number; height?: number; fill?: boolean }) {
  const uid = useMemo(() => Math.random().toString(36).slice(2, 7), []);
  if (values.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 2) + 1, height - 3 - (v / max) * (height - 6)] as const);
  const line = smoothPath(pts);
  return (
    <svg width={width} height={height} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={`s-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${width - 1},${height} L1,${height} Z`} fill={`url(#s-${uid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
