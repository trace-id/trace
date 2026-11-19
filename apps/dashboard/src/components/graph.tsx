'use client';

import type { GraphNode, GraphResponse } from '@trace-id/signals/api';
import { Minus, Plus, Scan } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { scoreTone } from '@/lib/format';

interface Placed extends GraphNode {
  x: number;
  y: number;
}

const W = 900;
const H = 560;

/** Force layout, run to rest up front so the graph appears settled and never jitters. Deterministic for a given input. */
export function layout(nodes: GraphNode[], edges: GraphResponse['edges'], seed: string): Placed[] {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const pos = nodes.map((nd, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = nd.id === seed ? 0 : 120 + (i % 7) * 18;
    return { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const links = edges.flatMap((e) => {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    return a === undefined || b === undefined ? [] : [[a, b] as const];
  });
  const degree = new Array<number>(n).fill(0);
  for (const [a, b] of links) {
    degree[a]!++;
    degree[b]!++;
  }
  const iterations = n > 90 ? 220 : 320;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (i % 2 ? 1 : -1) * 0.1;
          dy = 0.1;
          d2 = 0.02;
        }
        // Accounts and IPs are hubs that connect to the same devices; push them apart so they do not stack in the middle.
        const hubs = nodes[i]!.type !== 'visitor' && nodes[j]!.type !== 'visitor' ? 9 : 1;
        const f = ((9000 * hubs * (1 + (degree[i]! + degree[j]!) * 0.08)) / d2) * cool;
        const d = Math.sqrt(d2);
        // Collision: nodes may never overlap, even when they have identical connections.
        const clash = d < 38 ? (38 - d) * 0.9 : 0;
        const push = f + clash;
        pos[i]!.vx += (dx / d) * push;
        pos[i]!.vy += (dy / d) * push;
        pos[j]!.vx -= (dx / d) * push;
        pos[j]!.vy -= (dy / d) * push;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b]!.x - pos[a]!.x;
      const dy = pos[b]!.y - pos[a]!.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 120) * 0.035;
      pos[a]!.vx += (dx / d) * f;
      pos[a]!.vy += (dy / d) * f;
      pos[b]!.vx -= (dx / d) * f;
      pos[b]!.vy -= (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i]!;
      p.vx += (W / 2 - p.x) * 0.012;
      p.vy += (H / 2 - p.y) * 0.012;
      p.x += Math.max(-24, Math.min(24, p.vx));
      p.y += Math.max(-24, Math.min(24, p.vy));
      p.vx *= 0.6;
      p.vy *= 0.6;
    }
  }
  return nodes.map((nd, i) => ({ ...nd, x: pos[i]!.x, y: pos[i]!.y }));
}

const TYPE_FILL = { visitor: 'var(--signal)', account: 'var(--ink)', ip: 'var(--info)' } as const;
const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' } as const;

function radius(n: GraphNode): number {
  return 7 + Math.min(9, Math.log2(1 + n.events) * 1.6);
}

function Shape({ n, r, fill, stroke, strokeWidth }: { n: GraphNode; r: number; fill: string; stroke: string; strokeWidth: number }) {
  if (n.type === 'account') return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  if (n.type === 'ip') return <polygon points={`0,${-r - 2} ${r + 2},0 0,${r + 2} ${-r - 2},0`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  return <circle r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

export function GraphView({ graph, selected, onSelect, className }: { graph: GraphResponse; selected: string | null; onSelect: (n: GraphNode | null) => void; className?: string }) {
  const placed = useMemo(() => layout(graph.nodes, graph.edges, graph.seed), [graph]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [graph]);
  const [hover, setHover] = useState<string | null>(null);
  const fit = useMemo(() => {
    if (placed.length === 0) return { x: 0, y: 0, k: 1 };
    const xs = placed.map((p) => p.x);
    const ys = placed.map((p) => p.y);
    const minX = Math.min(...xs) - 40;
    const maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40;
    const maxY = Math.max(...ys) + 50;
    const k = Math.max(0.4, Math.min(2.6, (W * 0.92) / (maxX - minX), (H * 0.9) / (maxY - minY)));
    return { k, x: W / 2 - ((minX + maxX) / 2) * k, y: H / 2 - ((minY + maxY) / 2) * k };
  }, [placed]);
  const [view, setView] = useState(fit);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  useEffect(() => setView(fit), [fit]);

  // Native listener: React registers wheel handlers as passive, which cannot stop the page from scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const focus = hover ?? selected;
  const lit = focus ? new Set([focus, ...(neighbours.get(focus) ?? [])]) : null;

  function zoom(factor: number, cx = W / 2, cy = H / 2) {
    setView((v) => {
      const k = Math.max(0.35, Math.min(3.5, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  }

  return (
    <div className={cn('relative overflow-hidden rounded-[14px] border border-line bg-surface', className)}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Relationship graph of devices, accounts and IP addresses"
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-node]')) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !svg.current) return;
          const scale = W / svg.current.getBoundingClientRect().width;
          setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) * scale, y: d.vy + (e.clientY - d.y) * scale }));
        }}
        onPointerUp={() => (drag.current = null)}
        onClick={(e) => {
          if (!(e.target as Element).closest('[data-node]')) onSelect(null);
        }}
      >
        <defs>
          <pattern id="gdots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line-strong)" opacity="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#gdots)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((e) => {
            const a = byId.get(e.source);
            const b = byId.get(e.target);
            if (!a || !b) return null;
            const on = !lit || (lit.has(e.source) && lit.has(e.target));
            return (
              <line
                key={`${e.source}|${e.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={on && focus ? 'var(--ink-3)' : 'var(--line-strong)'}
                strokeWidth={Math.min(3, 0.8 + Math.log2(1 + e.weight) * 0.35)}
                opacity={on ? 1 : 0.15}
              />
            );
          })}
          {placed.map((n) => {
            const r = radius(n);
            const on = !lit || lit.has(n.id);
            const isSeed = n.id === graph.seed;
            const showLabel = isSeed || n.id === focus || (lit?.has(n.id) && n.id !== focus && placed.length < 40);
            return (
              <g
                key={n.id}
                data-node
                transform={`translate(${n.x} ${n.y})`}
                opacity={on ? 1 : 0.18}
                className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n);
                }}
              >
                {n.score >= 70 && <circle r={r + 7} fill="var(--bad)" opacity="0.16" />}
                <Shape n={n} r={r} fill={TYPE_FILL[n.type]} stroke={n.id === selected ? 'var(--signal-bright)' : TONE[scoreTone(n.score)]} strokeWidth={n.id === selected ? 3.5 : 2.2} />
                {isSeed && <circle r={r + 5} fill="none" stroke="var(--ink)" strokeDasharray="3 3" />}
                {showLabel && (
                  <text y={(r + 15 / view.k)} textAnchor="middle" fontSize={11 / view.k} fontFamily="var(--font-mono)" fill="var(--ink)" stroke="var(--surface)" strokeWidth={3 / view.k} paintOrder="stroke">
                    {n.label.length > 18 ? `${n.label.slice(0, 16)}…` : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-3 top-3 grid gap-1">
        {[
          [Plus, 'Zoom in', () => zoom(1.25)],
          [Minus, 'Zoom out', () => zoom(1 / 1.25)],
          [Scan, 'Fit to screen', () => setView(fit)],
        ].map(([I, label, fn]) => {
          const Icon = I as typeof Plus;
          return (
            <button key={label as string} aria-label={label as string} onClick={fn as () => void} className="grid size-8 cursor-pointer place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 shadow-card hover:bg-surface-3">
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-surface/90 px-3 py-2 text-[11px] text-ink-2 backdrop-blur">
        <span className="flex items-center gap-1.5"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--signal)" /></svg> Device</span>
        <span className="flex items-center gap-1.5"><svg width="12" height="12"><rect x="1" y="1" width="10" height="10" rx="2" fill="var(--ink)" /></svg> Account</span>
        <span className="flex items-center gap-1.5"><svg width="12" height="12"><polygon points="6,0 12,6 6,12 0,6" fill="var(--info)" /></svg> IP address</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-bad" /> High risk edge</span>
      </div>
    </div>
  );
}
