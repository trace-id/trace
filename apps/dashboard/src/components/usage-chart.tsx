'use client';

import type { UsageDay } from '@tbdname/signals/api';

/** Stacked daily bars: suspicious events on top of the rest. Plain SVG, no chart library. */
export function UsageChart({ days }: { days: UsageDay[] }) {
  const width = 720;
  const height = 160;
  const pad = { top: 8, bottom: 20, left: 32 };
  const max = Math.max(1, ...days.map((d) => d.events));
  const barW = (width - pad.left) / Math.max(days.length, 1);
  const y = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - v / max);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Events per day" style={{ width: '100%', height: 'auto' }}>
      <text x={0} y={pad.top + 8} fontSize="10" fill="var(--muted)">
        {max}
      </text>
      <text x={0} y={height - pad.bottom} fontSize="10" fill="var(--muted)">
        0
      </text>
      {days.map((d, i) => {
        const x = pad.left + i * barW + 1;
        const w = Math.max(barW - 2, 1);
        const clean = d.events - d.suspicious;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.events} events, ${d.suspicious} suspicious, ${d.newVisitors} new visitors`}</title>
            <rect x={x} y={y(clean)} width={w} height={y(0) - y(clean)} fill="var(--accent)" opacity={0.75} rx={1} />
            <rect x={x} y={y(d.events)} width={w} height={y(clean) - y(d.events)} fill="var(--bad)" rx={1} />
            {(i === 0 || i === days.length - 1) && (
              <text x={x} y={height - 4} fontSize="10" fill="var(--muted)">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
