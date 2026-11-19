import { type IdentificationConfig } from '@trace-id/signals/config';
import { type FrequencyTable } from '@trace-id/signals/linkage';
import { type ComponentName, type Components } from '@trace-id/signals/types';
import { bucketHashes, type CandidateSource, matchVisitor, type VisitorSnapshot } from '../identification/engine.js';

export interface FixtureSession {
  id: string;
  /** Ground truth: one browser installation on one device. */
  device: string;
  /** Browser storage profile. Same profile = the persisted token is still there. */
  profile: string;
  scenario: string;
  components: Components;
}

export interface Fixture {
  name: string;
  description: string;
  synthetic: boolean;
  sessions: FixtureSession[];
}

export interface ScenarioStats {
  sessions: number;
  correct: number;
}

export interface AccuracyReport {
  fixture: string;
  synthetic: boolean;
  sessions: number;
  devices: number;
  visitors: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of devices whose first session was attached to another device's visitor. */
  falseMergeRate: number;
  /** Share of devices whose first session is identical to another device's: no engine can split these. */
  indistinguishableRate: number;
  byScenario: Record<string, ScenarioStats>;
}

/** In-memory twin of the Postgres candidate source, with the same update rules as ingest. */
class MemoryStore implements CandidateSource {
  private readonly visitors = new Map<string, VisitorSnapshot>();
  private readonly buckets = new Map<string, Set<string>>();
  private readonly counts = new Map<string, number>();

  constructor(private readonly config: IdentificationConfig) {}

  /** Visitors per component value, kept in step with each visitor's latest components (as the server does). */
  async frequencies(): Promise<FrequencyTable> {
    const counts = this.counts;
    return { total: this.visitors.size, count: (c: ComponentName, v: string) => counts.get(`${c}:${v}`) ?? 0 };
  }

  private bump(components: Components, by: number): void {
    for (const [c, v] of Object.entries(components)) {
      if (v === undefined) continue;
      const key = `${c}:${v}`;
      this.counts.set(key, (this.counts.get(key) ?? 0) + by);
    }
  }

  async byBuckets(hashes: string[], limit: number): Promise<VisitorSnapshot[]> {
    const ids = new Set<string>();
    for (const h of hashes) for (const id of [...(this.buckets.get(h) ?? [])].sort()) ids.add(id);
    return [...ids].slice(0, limit).map((id) => this.visitors.get(id) as VisitorSnapshot);
  }

  async byId(id: string): Promise<VisitorSnapshot | null> {
    return this.visitors.get(id) ?? null;
  }

  save(id: string, components: Components, at: Date): void {
    const previous = this.visitors.get(id);
    if (previous) this.bump(previous.components, -1);
    this.bump(components, 1);
    this.visitors.set(id, { id, components, lastSeenAt: at });
    for (const h of bucketHashes(components, this.config.buckets)) {
      let set = this.buckets.get(h);
      if (!set) this.buckets.set(h, (set = new Set()));
      set.add(id);
    }
  }
}

function pairs(n: number): number {
  return (n * (n - 1)) / 2;
}

function ratio(num: number, den: number): number {
  return den === 0 ? 1 : num / den;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export async function runFixture(fixture: Fixture, config: IdentificationConfig): Promise<AccuracyReport> {
  const store = new MemoryStore(config);
  const tokens = new Map<string, string>();
  const assigned: string[] = [];
  const deviceFirstVisitor = new Map<string, string>();
  const visitorOwner = new Map<string, string>();
  const byScenario: Record<string, ScenarioStats> = {};
  let falseMerges = 0;
  let nextId = 0;

  for (const [i, s] of fixture.sessions.entries()) {
    const decision = await matchVisitor(
      { components: s.components, tokenVisitorId: tokens.get(s.profile) ?? null },
      store,
      config,
    );
    const visitorId = decision.visitorId ?? `v${++nextId}`;
    store.save(visitorId, s.components, new Date(Date.UTC(2026, 0, 1) + i * 60_000));
    tokens.set(s.profile, visitorId);
    assigned.push(visitorId);

    const first = deviceFirstVisitor.get(s.device);
    let correct: boolean;
    if (first === undefined) {
      deviceFirstVisitor.set(s.device, visitorId);
      const owner = visitorOwner.get(visitorId);
      correct = owner === undefined;
      if (!correct) falseMerges++;
      else visitorOwner.set(visitorId, s.device);
    } else {
      correct = visitorId === first;
    }
    const stats = (byScenario[s.scenario] ??= { sessions: 0, correct: 0 });
    stats.sessions++;
    if (correct) stats.correct++;
  }

  const cell = new Map<string, number>();
  const perVisitor = new Map<string, number>();
  const perDevice = new Map<string, number>();
  fixture.sessions.forEach((s, i) => {
    const v = assigned[i] as string;
    cell.set(`${v}\u0000${s.device}`, (cell.get(`${v}\u0000${s.device}`) ?? 0) + 1);
    perVisitor.set(v, (perVisitor.get(v) ?? 0) + 1);
    perDevice.set(s.device, (perDevice.get(s.device) ?? 0) + 1);
  });
  const firstSignature = new Map<string, string>();
  for (const s of fixture.sessions) {
    if (!firstSignature.has(s.device)) firstSignature.set(s.device, JSON.stringify(Object.entries(s.components).sort()));
  }
  const signatureCounts = new Map<string, number>();
  for (const sig of firstSignature.values()) signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
  const indistinguishable = [...firstSignature.values()].filter((sig) => (signatureCounts.get(sig) ?? 0) > 1).length;

  const tp = [...cell.values()].reduce((sum, n) => sum + pairs(n), 0);
  const predicted = [...perVisitor.values()].reduce((sum, n) => sum + pairs(n), 0);
  const actual = [...perDevice.values()].reduce((sum, n) => sum + pairs(n), 0);
  const precision = ratio(tp, predicted);
  const recall = ratio(tp, actual);

  return {
    fixture: fixture.name,
    synthetic: fixture.synthetic,
    sessions: fixture.sessions.length,
    devices: perDevice.size,
    visitors: perVisitor.size,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
    falseMergeRate: round4(perDevice.size === 0 ? 0 : falseMerges / perDevice.size),
    indistinguishableRate: round4(perDevice.size === 0 ? 0 : indistinguishable / perDevice.size),
    byScenario,
  };
}
