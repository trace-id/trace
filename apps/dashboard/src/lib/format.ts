export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function shortId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export function scoreTone(score: number): 'ok' | 'warn' | 'bad' {
  if (score >= 70) return 'bad';
  if (score >= 30) return 'warn';
  return 'ok';
}

export function scoreLabel(score: number): string {
  if (score >= 70) return 'High risk';
  if (score >= 30) return 'Medium';
  return 'Low';
}

const nf = new Intl.NumberFormat('en-US');
export function num(n: number): string {
  return nf.format(n);
}

export function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}

/** Change from `previous` to `current` as a signed ratio; null when there is nothing to compare. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
  }
  return 'now';
}

export function shortDay(key: string): string {
  const hourly = key.length > 10;
  const d = new Date(hourly ? `${key}:00:00Z` : `${key}T00:00:00Z`);
  return hourly
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
