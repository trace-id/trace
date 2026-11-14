import { type ComponentName } from './types.js';

export const SIGNAL_IDS = [
  'bot',
  'tampering',
  'tor',
  'datacenterIp',
  'ipBlocklist',
  'velocity',
  'incognito',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

export interface IdentificationConfig {
  matchThreshold: number;
  tokenAgreementThreshold: number;
  minSharedWeightRatio: number;
  ambiguityMargin: number;
  maxCandidates: number;
  componentWeights: Partial<Record<ComponentName, number>>;
  buckets: ComponentName[][];
}

export interface VelocityThresholds {
  eventsPerVisitor1h: number;
  visitorsPerIp1h: number;
  ipsPerVisitor24h: number;
  visitorsPerLinkedId24h: number;
}

export interface ScoringConfig {
  version: 1;
  identification: IdentificationConfig;
  suspect: {
    weights: Record<SignalId, number>;
  };
  velocity: VelocityThresholds;
}
