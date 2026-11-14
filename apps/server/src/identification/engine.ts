import { createHash } from 'node:crypto';
import { type IdentificationConfig } from '@tbdname/signals/config';
import { componentSimilarity } from '@tbdname/signals/similarity';
import { type Components } from '@tbdname/signals/types';

export interface VisitorSnapshot {
  id: string;
  components: Components;
  lastSeenAt: Date;
}

/** Where candidates come from: Postgres in the server, a Map in the accuracy harness. */
export interface CandidateSource {
  byBuckets(bucketHashes: string[], limit: number): Promise<VisitorSnapshot[]>;
  byId(visitorId: string): Promise<VisitorSnapshot | null>;
}

export type MatchDecision =
  | { kind: 'token'; visitorId: string; confidence: number; similarity: number }
  | { kind: 'similar'; visitorId: string; confidence: number; similarity: number }
  | { kind: 'new'; visitorId: null; confidence: number; similarity: number };

export interface MatchInput {
  components: Components;
  tokenVisitorId: string | null;
}

/**
 * One hash per configured bucket whose components are all present. Bucket index is part of
 * the hash so equal values in different buckets never collide.
 */
export function bucketHashes(components: Components, buckets: IdentificationConfig['buckets']): string[] {
  const out: string[] = [];
  buckets.forEach((names, index) => {
    const values = names.map((n) => components[n]);
    if (values.some((v) => v === undefined)) return;
    out.push(createHash('sha256').update(`${index}|${values.join('|')}`).digest('hex'));
  });
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compareCandidates(a: { s: number; v: VisitorSnapshot }, b: { s: number; v: VisitorSnapshot }): number {
  if (b.s !== a.s) return b.s - a.s;
  const t = b.v.lastSeenAt.getTime() - a.v.lastSeenAt.getTime();
  if (t !== 0) return t;
  return a.v.id < b.v.id ? -1 : a.v.id > b.v.id ? 1 : 0;
}

/**
 * Deterministic for a given input and candidate set.
 * 1. A valid token whose visitor still roughly agrees wins outright.
 * 2. Otherwise the most similar bucket candidate above matchThreshold wins; confidence is
 *    discounted when the runner-up is within ambiguityMargin.
 * 3. Otherwise a new visitor; confidence reflects how far the nearest candidate was.
 */
export async function matchVisitor(
  input: MatchInput,
  source: CandidateSource,
  config: IdentificationConfig,
): Promise<MatchDecision> {
  if (input.tokenVisitorId !== null) {
    const tokenVisitor = await source.byId(input.tokenVisitorId);
    if (tokenVisitor) {
      const s = componentSimilarity(input.components, tokenVisitor.components, config);
      if (s >= config.tokenAgreementThreshold) {
        return { kind: 'token', visitorId: tokenVisitor.id, confidence: round2(Math.min(0.99, 0.9 + 0.1 * s)), similarity: s };
      }
    }
  }

  const hashes = bucketHashes(input.components, config.buckets);
  const candidates = hashes.length > 0 ? await source.byBuckets(hashes, config.maxCandidates) : [];
  const seen = new Set<string>();
  const scored = candidates
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .map((v) => ({ v, s: componentSimilarity(input.components, v.components, config) }))
    .sort(compareCandidates);

  const best = scored[0];
  if (best && best.s >= config.matchThreshold) {
    const runnerUp = scored[1]?.s ?? 0;
    const margin = best.s - runnerUp;
    const ambiguity = Math.max(0, config.ambiguityMargin - margin) / config.ambiguityMargin;
    return { kind: 'similar', visitorId: best.v.id, confidence: round2(best.s * (1 - 0.5 * ambiguity)), similarity: best.s };
  }

  const nearest = best?.s ?? 0;
  return { kind: 'new', visitorId: null, confidence: round2(1 - 0.5 * nearest), similarity: nearest };
}
