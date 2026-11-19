import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_ACCOUNTS_CONFIG, DEFAULT_FLAGGED_NETWORK_CONFIG, DEFAULT_RARE_DEVICE_CONFIG, LATER_VELOCITY_DEFAULTS, SIGNAL_IDS, type ScoringConfig } from '@trace-id/signals/config';
import { DEFAULT_CROSS_BROWSER_CONFIG, DEVICE_FEATURES } from '@trace-id/signals/crossbrowser';
import { DEFAULT_LINKAGE_CONFIG } from '@trace-id/signals/linkage';
import { COMPONENT_NAMES } from '@trace-id/signals/types';
import { z } from 'zod';
import { DEFAULT_SCORING_RAW } from './default-scoring.js';

const ratio = z.number().min(0).max(1);
const component = z.enum(COMPONENT_NAMES);
const weight = z.number().min(0).max(1000);
const deviceFeature = z.enum(DEVICE_FEATURES);
// Signals added after the first release default their weight, so existing private override files keep loading.
const LATER_SIGNALS: Partial<Record<(typeof SIGNAL_IDS)[number], number>> = {
  crossBrowser: 15,
  antiDetect: 40,
  vpn: 20,
  tlsMismatch: 30,
  multiAccount: 25,
  accountSharing: 10,
  automatedInput: 30,
  aiAgent: 20,
  proxy: 20,
  rareDevice: 10,
  tamperedRequest: 30,
  replayedRequest: 50,
  flaggedNetwork: 15,
  emulator: 30,
  rootedDevice: 20,
};

// Every field defaults, so a crossBrowser section written for an older release keeps loading as traits are added.
const CB = DEFAULT_CROSS_BROWSER_CONFIG;
const crossBrowserSchema = z
  .object({
    weights: z
      .object(
        Object.fromEntries(DEVICE_FEATURES.map((f) => [f, weight.default(CB.weights[f])])) as Record<
          (typeof DEVICE_FEATURES)[number],
          z.ZodDefault<typeof weight>
        >,
      )
      .strict()
      .default(CB.weights),
    required: z.array(deviceFeature).max(DEVICE_FEATURES.length).default(CB.required),
    minSharedWeightRatio: ratio.default(CB.minSharedWeightRatio),
    linkThreshold: ratio.default(CB.linkThreshold),
    signalThreshold: ratio.default(CB.signalThreshold),
    requireSharedNetwork: z.boolean().default(CB.requireSharedNetwork),
    otherNetworkFactor: ratio.default(CB.otherNetworkFactor),
    networkWindowHours: z.number().min(1).max(24 * 90).default(CB.networkWindowHours),
    maxCandidates: z.number().int().min(1).max(500).default(CB.maxCandidates),
    busyNetworkVisitors: z.number().int().min(1).max(100_000).default(CB.busyNetworkVisitors),
    rareHardwareMaxVisitors: z.number().int().min(0).max(100).default(CB.rareHardwareMaxVisitors),
    rareHardwareMinSimilarity: ratio.default(CB.rareHardwareMinSimilarity),
  })
  .strict();

const LK = DEFAULT_LINKAGE_CONFIG;
const probability = z.number().gt(0).lt(1);
const linkageSchema = z
  .object({
    changeRate: z.partialRecord(component, probability).default(LK.changeRate),
    priorFrequency: z.partialRecord(component, probability).default(LK.priorFrequency),
    priorStrength: z.number().min(0).max(100_000).default(LK.priorStrength),
    dependence: z.number().gt(0).max(1).default(LK.dependence),
    priorLogOdds: z.number().min(-50).max(50).default(LK.priorLogOdds),
    returningRate: probability.default(LK.returningRate),
    matchProbability: probability.default(LK.matchProbability),
    minSharedComponents: z.number().int().min(1).max(COMPONENT_NAMES.length).default(LK.minSharedComponents),
    groups: z.array(z.array(component).min(1)).max(COMPONENT_NAMES.length).default(LK.groups),
  })
  .strict();

const AC = DEFAULT_ACCOUNTS_CONFIG;
const accountsSchema = z
  .object({
    windowHours: z.number().min(1).max(24 * 365).default(AC.windowHours),
    maxAccountsPerDevice: z.number().int().min(1).max(10_000).default(AC.maxAccountsPerDevice),
    maxDevicesPerAccount: z.number().int().min(1).max(10_000).default(AC.maxDevicesPerAccount),
  })
  .strict();

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
        // Files written before linkage existed keep the weighted matcher they were tuned for.
        method: z.enum(['weighted', 'linkage']).default('weighted'),
        linkage: linkageSchema.default(DEFAULT_LINKAGE_CONFIG),
      })
      .strict(),
    suspect: z
      .object({
        weights: z.object(
          Object.fromEntries(
            SIGNAL_IDS.map((id) => [id, LATER_SIGNALS[id] === undefined ? weight : weight.default(LATER_SIGNALS[id])]),
          ) as Record<(typeof SIGNAL_IDS)[number], typeof weight>,
        ).strict(),
      })
      .strict(),
    velocity: z
      .object({
        eventsPerVisitor1h: z.number().int().min(1),
        eventsPerVisitor24h: z.number().int().min(1),
        visitorsPerIp1h: z.number().int().min(1),
        ipsPerVisitor24h: z.number().int().min(1),
        visitorsPerLinkedId24h: z.number().int().min(1),
        eventsPerVisitor5m: z.number().int().min(1).default(LATER_VELOCITY_DEFAULTS.eventsPerVisitor5m),
        countriesPerVisitor24h: z.number().int().min(1).default(LATER_VELOCITY_DEFAULTS.countriesPerVisitor24h),
        linkedIdsPerVisitor24h: z.number().int().min(1).default(LATER_VELOCITY_DEFAULTS.linkedIdsPerVisitor24h),
      })
      .strict(),
    crossBrowser: crossBrowserSchema.default(DEFAULT_CROSS_BROWSER_CONFIG),
    accounts: accountsSchema.default(DEFAULT_ACCOUNTS_CONFIG),
    rareDevice: z
      .object({ minVisitors: z.number().int().min(1), maxShare: z.number().gt(0).max(1) })
      .strict()
      .default(DEFAULT_RARE_DEVICE_CONFIG),
    flaggedNetwork: z
      .object({
        windowHours: z.number().int().min(1).max(720),
        flagScore: z.number().int().min(1).max(100),
        minFlagged: z.number().int().min(1),
        minShare: z.number().gt(0).max(1),
      })
      .strict()
      .default(DEFAULT_FLAGGED_NETWORK_CONFIG),
  })
  .strict();

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


/** The bundled default, validated once. */
export const DEFAULT_SCORING: ScoringConfig = parseScoringConfig(DEFAULT_SCORING_RAW);
