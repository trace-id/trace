import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SIGNAL_IDS, type ScoringConfig } from '@tbdname/signals/config';
import { COMPONENT_NAMES } from '@tbdname/signals/types';
import { z } from 'zod';

const ratio = z.number().min(0).max(1);
const component = z.enum(COMPONENT_NAMES);
const weight = z.number().min(0).max(1000);

const scoringSchema = z
  .object({
    version: z.literal(1),
    identification: z
      .object({
        matchThreshold: ratio,
        tokenAgreementThreshold: ratio,
        minSharedWeightRatio: ratio,
        ambiguityMargin: z.number().gt(0).max(1),
        maxCandidates: z.number().int().min(1).max(500),
        componentWeights: z.partialRecord(component, weight),
        buckets: z.array(z.array(component).min(1)).min(1).max(10),
      })
      .strict(),
    suspect: z
      .object({
        weights: z.object(Object.fromEntries(SIGNAL_IDS.map((id) => [id, weight])) as Record<
          (typeof SIGNAL_IDS)[number],
          typeof weight
        >).strict(),
      })
      .strict(),
    velocity: z
      .object({
        eventsPerVisitor1h: z.number().int().min(1),
        visitorsPerIp1h: z.number().int().min(1),
        ipsPerVisitor24h: z.number().int().min(1),
        visitorsPerLinkedId24h: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();

export const SCORING = Symbol('SCORING');

export function parseScoringConfig(raw: unknown): ScoringConfig {
  const result = scoringSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid scoring config: ${problems}`);
  }
  return result.data as ScoringConfig;
}

function findDefault(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, 'scoring.default.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** An explicit path (e.g. a private tuned override) wins over the bundled default. */
export function loadScoringConfig(explicitPath?: string, cwd: string = process.cwd()): ScoringConfig {
  const path = explicitPath ?? findDefault(cwd);
  if (path === null) throw new Error('scoring.default.json not found; set SCORING_CONFIG_PATH');
  return parseScoringConfig(JSON.parse(readFileSync(path, 'utf8')));
}
