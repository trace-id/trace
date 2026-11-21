import { type UsageEvent } from '@trace-id/ip-intel';

/** Fan-out for usage events: sources emit, the service that stores them listens. Listeners must not throw. */
export class UsageHub {
  private readonly listeners = new Set<(e: UsageEvent) => void>();

  emit = (event: UsageEvent): void => {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // Counting usage must never break a lookup.
      }
    }
  };

  subscribe(listener: (e: UsageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface UsageRow {
  day: string;
  providerRef: string;
  keyRef: string;
  provider: string;
  requests: number;
  ok: number;
  errors: number;
  rateLimited: number;
  authFailed: number;
  skipped: number;
  latencyMs: number;
}

const zero = (day: string, providerRef: string, keyRef: string, provider: string): UsageRow => ({
  day,
  providerRef,
  keyRef,
  provider,
  requests: 0,
  ok: 0,
  errors: 0,
  rateLimited: 0,
  authFailed: 0,
  skipped: 0,
  latencyMs: 0,
});

/**
 * Counters per UTC day, provider and key, held in memory and written in batches. `requests` counts calls made to the
 * provider (everything except lookups left out by the traffic share, which are counted as `skipped`).
 */
export class UsageBuffer {
  private rows = new Map<string, UsageRow>();

  constructor(
    private readonly providerName: (providerRef: string) => string,
    private readonly now: () => number = Date.now,
  ) {}

  add(e: UsageEvent): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const keyRef = e.keyId ?? '';
    const id = `${day}|${e.providerRef}|${keyRef}`;
    let row = this.rows.get(id);
    if (!row) {
      row = zero(day, e.providerRef, keyRef, this.providerName(e.providerRef));
      this.rows.set(id, row);
    }
    if (e.outcome === 'skipped') {
      row.skipped++;
      return;
    }
    row.requests++;
    row.latencyMs += Math.max(0, Math.round(e.latencyMs));
    if (e.outcome === 'ok') row.ok++;
    else if (e.outcome === 'rateLimited') row.rateLimited++;
    else if (e.outcome === 'authFailed') row.authFailed++;
    else row.errors++;
  }

  /** Takes everything counted so far. */
  drain(): UsageRow[] {
    const out = [...this.rows.values()];
    this.rows = new Map();
    return out;
  }

  /** Puts rows back after a failed write, merging with anything counted meanwhile. */
  restore(rows: UsageRow[]): void {
    for (const r of rows) {
      const id = `${r.day}|${r.providerRef}|${r.keyRef}`;
      const cur = this.rows.get(id);
      if (!cur) {
        this.rows.set(id, r);
        continue;
      }
      cur.requests += r.requests;
      cur.ok += r.ok;
      cur.errors += r.errors;
      cur.rateLimited += r.rateLimited;
      cur.authFailed += r.authFailed;
      cur.skipped += r.skipped;
      cur.latencyMs += r.latencyMs;
    }
  }

  /** What is counted but not yet written, for adding to stored totals. */
  pending(): UsageRow[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
