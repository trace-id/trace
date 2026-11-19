import { createHash } from 'node:crypto';
import { type IdentificationConfig } from '@trace-id/signals/config';
import { DEFAULT_LINKAGE_CONFIG, EMPTY_FREQUENCIES, type FrequencyTable, linkageScore } from '@trace-id/signals/linkage';
import { componentSimilarity } from '@trace-id/signals/similarity';
import { type Components } from '@trace-id/signals/types';

export interface VisitorSnapshot {
  id: string;
  components: Components;
  lastSeenAt: Date;
}

/** Where candidates come from: Postgres in the server, a Map in the accuracy harness. */
export interface CandidateSource {
  byBuckets(bucketHashes: string[], limit: number): Promise<VisitorSnapshot[]>;
  byId(visitorId: string): Promise<VisitorSnapshot | null>;
  /** Value frequencies for the linkage method; sources without statistics fall back to the priors. */
  frequencies?(components: Components): Promise<FrequencyTable>;
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
/**
 * Two app installs with different install ids are different devices, however alike the rest looks: many phones of one
 * model share every other reading. Browsers send no install id, so this never applies to them.
 */
function differentInstall(a: Components, b: Components): boolean {
  return a.appInstall !== undefined && b.appInstall !== undefined && a.appInstall !== b.appInstall;
}

export async function matchVisitor(
  input: MatchInput,
  source: CandidateSource,
  config: IdentificationConfig,
): Promise<MatchDecision> {
  if (input.tokenVisitorId !== null) {
    const tokenVisitor = await source.byId(input.tokenVisitorId);
    if (tokenVisitor && !differentInstall(input.components, tokenVisitor.components)) {
      const s = componentSimilarity(input.components, tokenVisitor.components, config);
      if (s >= config.tokenAgreementThreshold) {
        return { kind: 'token', visitorId: tokenVisitor.id, confidence: round2(Math.min(0.99, 0.9 + 0.1 * s)), similarity: s };
      }
    }
  }

  const hashes = bucketHashes(input.components, config.buckets);
  const candidates = hashes.length > 0 ? await source.byBuckets(hashes, config.maxCandidates) : [];
  const seen = new Set<string>();
  const unique = candidates.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)) && !differentInstall(input.components, v.components));

  const linkage = config.method === 'linkage';
  const lcfg = config.linkage ?? DEFAULT_LINKAGE_CONFIG;
  const table = linkage && unique.length > 0 ? ((await source.frequencies?.(input.components)) ?? EMPTY_FREQUENCIES) : EMPTY_FREQUENCIES;
  // s decides (linkage probability or weighted similarity); w is the weighted similarity, reported as `similarity`.
  const scored = unique
    .map((v) => {
      const w = componentSimilarity(input.components, v.components, config);
      return { v, w, s: linkage ? linkageScore(input.components, v.components, table, lcfg, unique.length).probability : w };
    })
    .sort(compareCandidates);

  const threshold = linkage ? lcfg.matchProbability : config.matchThreshold;
  const best = scored[0];
  if (best && best.s >= threshold) {
    const runnerUp = scored[1]?.s ?? 0;
    const margin = best.s - runnerUp;
    const ambiguity = Math.max(0, config.ambiguityMargin - margin) / config.ambiguityMargin;
    return { kind: 'similar', visitorId: best.v.id, confidence: round2(best.s * (1 - 0.5 * ambiguity)), similarity: best.w };
  }

  const nearest = best?.s ?? 0;
  return { kind: 'new', visitorId: null, confidence: round2(1 - 0.5 * nearest), similarity: best?.w ?? 0 };
}
