import { type ScoreReason } from './scoring.js';

/**
 * Network reputation for the flaggedNetwork signal: how many other visitors used this IP network (the keyed /24 or /64
 * that cross-browser linking uses) recently, and how many of them were flagged. Pure: callers fetch the rows.
 */
export interface NetworkReputation {
  /** Other visitors seen on the network in the window. */
  visitors: number;
  /** Of those, how many had an event at or above the flag score. */
  flagged: number;
}

export interface NeighborEvent {
  visitorId: string;
  suspectScore: number;
  reasons: readonly ScoreReason[] | unknown;
}

/**
 * Counts flagged neighbours. A neighbour's own flaggedNetwork contribution is taken off its score first, so a network
 * cannot flag itself through this signal and the count does not snowball.
 */
export function countFlaggedNeighbors(events: readonly NeighborEvent[], flagScore: number): number {
  const flagged = new Set<string>();
  for (const e of events) {
    const reasons = Array.isArray(e.reasons) ? (e.reasons as ScoreReason[]) : [];
    const own = reasons.find((r) => r?.signal === 'flaggedNetwork')?.contribution ?? 0;
    if (e.suspectScore - own >= flagScore) flagged.add(e.visitorId);
  }
  return flagged.size;
}
