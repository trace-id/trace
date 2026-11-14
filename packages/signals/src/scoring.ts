import { SIGNAL_IDS, type ScoringConfig, type SignalId } from './config.js';
import { type SignalResults } from './definitions.js';

export interface ScoreReason {
  signal: SignalId;
  contribution: number;
}

export interface SuspectScore {
  score: number;
  reasons: ScoreReason[];
}

/** 0-100. Contributions are reported before capping so customers see the full picture. */
export function computeSuspectScore(results: SignalResults, config: ScoringConfig): SuspectScore {
  const reasons: ScoreReason[] = [];
  let total = 0;
  for (const id of SIGNAL_IDS) {
    if (!results[id].detected) continue;
    const weight = config.suspect.weights[id];
    if (weight <= 0) continue;
    total += weight;
    reasons.push({ signal: id, contribution: weight });
  }
  reasons.sort((a, b) => b.contribution - a.contribution || (a.signal < b.signal ? -1 : 1));
  return { score: Math.min(100, Math.round(total)), reasons };
}
