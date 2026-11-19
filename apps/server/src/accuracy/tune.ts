import { SIGNAL_IDS, type SignalId } from '@trace-id/signals/config';
import { fitLogistic, rocAuc, type FitOptions } from '@trace-id/signals/fraud-score';

/**
 * Learns suspect-score weights from labelled events: logistic regression on which signals fired, then a rescale so the
 * additive 0-100 score reaches `blockScore` where the model's fraud probability reaches 50%. Pure: no I/O.
 */

export interface LabeledExample {
  detected: Partial<Record<SignalId, boolean>>;
  fraud: boolean;
}

export interface SignalStats {
  /** Events where the signal fired. */
  fired: number;
  /** Share of those that were fraud; null when it never fired. */
  fraudRate: number | null;
  coefficient: number;
  weight: number;
}

export interface TuneResult {
  n: number;
  positives: number;
  intercept: number;
  weights: Record<SignalId, number>;
  signals: Record<SignalId, SignalStats>;
  /** Area under the ROC curve of the capped additive score with the learned weights, on the same data. */
  auc: number;
  /** The same for the weights passed in as `current`, for comparison. */
  currentAuc: number | null;
  /** Signals that fired too rarely to learn from; their current weight is kept. */
  keptForLowSupport: SignalId[];
}

export { fitLogistic, rocAuc, type FitOptions } from '@trace-id/signals/fraud-score';

export function additiveScore(detected: Partial<Record<SignalId, boolean>>, weights: Record<SignalId, number>): number {
  let total = 0;
  for (const id of SIGNAL_IDS) if (detected[id]) total += weights[id] ?? 0;
  return Math.min(100, total);
}

export interface TuneOptions extends FitOptions {
  /** Score at which the model says 50% fraud (the suggested blocking threshold). Default 60. */
  blockScore?: number;
  /** A signal must fire on at least this many events to be learned. Default 20. */
  minSupport?: number;
  current?: Record<SignalId, number>;
}

export function tuneWeights(examples: LabeledExample[], options: TuneOptions = {}): TuneResult {
  const { blockScore = 60, minSupport = 20, current } = options;
  const fired = Object.fromEntries(SIGNAL_IDS.map((id) => [id, examples.filter((e) => e.detected[id]).length])) as Record<SignalId, number>;
  const learnable = SIGNAL_IDS.filter((id) => fired[id] >= minSupport);
  const X = examples.map((e) => learnable.map((id) => (e.detected[id] ? 1 : 0)));
  const y = examples.map((e) => (e.fraud ? 1 : 0));
  const [intercept = 0, ...coefs] = fitLogistic(X, y, options);

  // Log-odds are additive like the score: map "intercept + sum(coef) = 0" (p = 0.5) to "sum(weight) = blockScore".
  const scale = intercept < 0 ? blockScore / -intercept : 15;
  const weights = {} as Record<SignalId, number>;
  const signals = {} as Record<SignalId, SignalStats>;
  const kept: SignalId[] = [];
  for (const id of SIGNAL_IDS) {
    const idx = learnable.indexOf(id);
    const coefficient = idx >= 0 ? coefs[idx]! : 0;
    let weight: number;
    if (idx >= 0) weight = Math.max(0, Math.min(100, Math.round(coefficient * scale)));
    else {
      weight = current?.[id] ?? 0;
      kept.push(id);
    }
    weights[id] = weight;
    const firedFraud = examples.filter((e) => e.detected[id] && e.fraud).length;
    signals[id] = {
      fired: fired[id],
      fraudRate: fired[id] > 0 ? Math.round((firedFraud / fired[id]) * 1000) / 1000 : null,
      coefficient: Math.round(coefficient * 1000) / 1000,
      weight,
    };
  }
  const labels = examples.map((e) => e.fraud);
  return {
    n: examples.length,
    positives: y.filter(Boolean).length,
    intercept: Math.round(intercept * 1000) / 1000,
    weights,
    signals,
    auc: rocAuc(examples.map((e) => additiveScore(e.detected, weights)), labels),
    currentAuc: current ? rocAuc(examples.map((e) => additiveScore(e.detected, current)), labels) : null,
    keptForLowSupport: kept,
  };
}

/** Parses "eventId,label" lines; label is fraud/1/true or legit/0/false. A header line is skipped. */
export function parseLabels(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const raw of text.split(/\r?\n/)) {
    const [id = '', label = ''] = raw.split(',').map((s) => s.trim());
    if (!id || id.toLowerCase() === 'eventid') continue;
    const l = label.toLowerCase();
    if (['fraud', '1', 'true', 'bad'].includes(l)) out.set(id, true);
    else if (['legit', '0', 'false', 'good'].includes(l)) out.set(id, false);
  }
  return out;
}
