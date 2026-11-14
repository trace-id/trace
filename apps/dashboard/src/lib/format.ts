export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export function scoreTone(score: number): 'ok' | 'warn' | 'bad' {
  if (score >= 70) return 'bad';
  if (score >= 30) return 'warn';
  return 'ok';
}
