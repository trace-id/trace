import { SIGNAL_IDS, type SignalId } from './config.js';
import { type AccountHistory } from './types.js';

/**
 * Fraud score from a project's own labels. Customers label events as fraud or legit per fraud type ("payment",
 * "account_takeover", ...); one logistic regression per type learns which signals predict it on that site, and every
 * new event gets a probability per type with the signals that pushed it up. Pure: no I/O.
 *
 * Features are 0/1: the signals that fired, plus context features (CONTEXT_FEATURES) read from the same stored event at
 * lower thresholds than the signals use, such as a brand-new visitor or an IP shared by a few visitors. The model learns
 * how much each matters on the site. Thousands of labels collapse to a few hundred distinct patterns, so training groups
 * identical patterns and fits with counts as weights: fast enough to run inline.
 */

/**
 * Context features: facts about the event that are not fraud signals on their own but often help predict a site's
 * fraud. Each is computed from what every event already stores (match, velocity and account counts, linked browsers,
 * time zone), so labels can snapshot them.
 */
export const CONTEXT_FEATURES = {
  newVisitor: 'First visit from this browser (no match to an earlier visitor).',
  weakMatch: 'Matched an earlier visitor by device traits with confidence below 0.8.',
  sharedIp: 'At least 3 visitors on this IP in the last hour.',
  manyIps: 'This visitor used at least 3 IPs in the last 24 hours.',
  eventBurst: 'At least 5 events from this visitor in the last hour.',
  sharedAccount: 'This account (linkedId) was used from at least 2 visitors in the last 24 hours.',
  multipleAccounts: 'At least 2 accounts (linkedIds) seen on this device.',
  otherBrowsers: 'The device was also seen in another browser or profile.',
  localNight: "Between 00:00 and 05:59 in the browser's time zone.",
  newAccount: 'The account (linkedId) was first seen less than 24 hours ago, or on this request.',
  newDeviceForAccount: 'An account older than 24 hours, on a device that never used it before.',
} as const;
export type ContextFeatureId = keyof typeof CONTEXT_FEATURES;
export const CONTEXT_FEATURE_IDS = Object.keys(CONTEXT_FEATURES) as ContextFeatureId[];

/** Everything a fraud model can use: signal ids and context feature ids. */
export type FraudFeature = SignalId | ContextFeatureId;
export const FRAUD_FEATURES: readonly FraudFeature[] = [...SIGNAL_IDS, ...CONTEXT_FEATURE_IDS];
const FEATURE_SET = new Set<string>(FRAUD_FEATURES);

/** Keeps known feature ids only (labels stored by older versions, or by a newer one, may differ). */
export const knownFeatures = (ids: readonly string[]): FraudFeature[] => ids.filter((id): id is FraudFeature => FEATURE_SET.has(id));

/** Fraud type names: lowercase, start with a letter, up to 32 characters. */
export const FRAUD_LABEL_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** Below this, a model would mostly learn noise; the type stays untrained. */
export const FRAUD_MODEL_MINIMUM = { examples: 30, perClass: 5 } as const;

export interface FraudExample {
  /** Signals that fired and context features that held on the labelled event. */
  detected: readonly FraudFeature[];
  fraud: boolean;
}

export interface FraudModel {
  version: 1;
  label: string;
  trainedAt: string;
  /** Labelled events the model was trained on, and how many of them were fraud. */
  n: number;
  positives: number;
  intercept: number;
  /** Log-odds added when a feature holds; features never seen in training are left out. */
  coefficients: Partial<Record<FraudFeature, number>>;
  /** Out-of-fold ROC AUC from k-fold cross-validation; null when there are too few labels per class to split. */
  cvAuc: number | null;
}

export interface FraudScore {
  label: string;
  /** Probability (0 to 1) that the event is this type of fraud, as learned from the project's labels. */
  probability: number;
  /** Signals and context features that raised the probability, strongest first. */
  reasons: FraudFeature[];
}

export interface FitOptions {
  /** L2 penalty; keeps rare signals from getting extreme weights. */
  l2?: number;
  iterations?: number;
  learningRate?: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Batch gradient descent on 0/1 features; `weights` count how many examples each row stands for. Returns
 * [intercept, ...coefficients].
 */
export function fitLogistic(X: number[][], y: number[], options: FitOptions = {}, weights?: number[]): number[] {
  const { l2 = 1, iterations = 3000, learningRate = 0.5 } = options;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d + 1).fill(0);
  const total = weights ? weights.reduce((a, b) => a + b, 0) : X.length;
  if (total === 0) return w;
  for (let it = 0; it < iterations; it++) {
    const grad = new Array<number>(d + 1).fill(0);
    for (let i = 0; i < X.length; i++) {
      const row = X[i]!;
      let z = w[0]!;
      for (let j = 0; j < d; j++) z += w[j + 1]! * row[j]!;
      const err = (sigmoid(z) - y[i]!) * (weights ? weights[i]! : 1);
      grad[0]! += err;
      for (let j = 0; j < d; j++) grad[j + 1]! += err * row[j]!;
    }
    w[0]! -= (learningRate * grad[0]!) / total;
    for (let j = 1; j <= d; j++) w[j]! -= (learningRate * (grad[j]! + l2 * w[j]!)) / total;
  }
  return w;
}

/** ROC AUC by the rank-sum method; ties count half. NaN when one class is missing. */
export function rocAuc(scores: number[], labels: boolean[]): number {
  const pos = labels.filter(Boolean).length;
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return Number.NaN;
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(scores.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = rank;
    i = j + 1;
  }
  const rankSum = labels.reduce((t, l, i) => t + (l ? ranks[i]! : 0), 0);
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Fits on the given examples over `features`, grouping identical (pattern, label) rows. */
function fit(examples: readonly FraudExample[], features: readonly FraudFeature[], options: FitOptions): number[] {
  const groups = new Map<string, { x: number[]; y: number; count: number }>();
  for (const e of examples) {
    const x = features.map((id) => (e.detected.includes(id) ? 1 : 0));
    const key = `${x.join('')}|${e.fraud ? 1 : 0}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { x, y: e.fraud ? 1 : 0, count: 1 });
  }
  const rows = [...groups.values()];
  return fitLogistic(
    rows.map((r) => r.x),
    rows.map((r) => r.y),
    options,
    rows.map((r) => r.count),
  );
}

function predict(coefs: number[], features: readonly FraudFeature[], detected: readonly FraudFeature[]): number {
  let z = coefs[0]!;
  features.forEach((id, j) => {
    if (detected.includes(id)) z += coefs[j + 1]!;
  });
  return sigmoid(z);
}

export interface TrainOptions extends FitOptions {
  now?: Date;
  /** Folds for the cross-validated AUC. Default 5. */
  folds?: number;
}

/** Trains one fraud type; null when there are fewer labels than FRAUD_MODEL_MINIMUM. */
export function trainFraudModel(label: string, examples: readonly FraudExample[], options: TrainOptions = {}): FraudModel | null {
  const { now = new Date(), folds = 5, ...fitOptions } = options;
  const positives = examples.filter((e) => e.fraud).length;
  const negatives = examples.length - positives;
  if (examples.length < FRAUD_MODEL_MINIMUM.examples) return null;
  if (positives < FRAUD_MODEL_MINIMUM.perClass || negatives < FRAUD_MODEL_MINIMUM.perClass) return null;

  const features = FRAUD_FEATURES.filter((id) => examples.some((e) => e.detected.includes(id)));
  const [intercept = 0, ...coefs] = fit(examples, features, fitOptions);

  // Out-of-fold predictions: each example is scored by a model that never saw it. Folds stratify by class so each
  // one holds both kinds.
  let cvAuc: number | null = null;
  if (positives >= folds && negatives >= folds) {
    const fold = new Array<number>(examples.length);
    let p = 0;
    let n = 0;
    examples.forEach((e, i) => (fold[i] = e.fraud ? p++ % folds : n++ % folds));
    const scores = new Array<number>(examples.length);
    for (let k = 0; k < folds; k++) {
      const model = fit(
        examples.filter((_, i) => fold[i] !== k),
        features,
        fitOptions,
      );
      examples.forEach((e, i) => {
        if (fold[i] === k) scores[i] = predict(model, features, e.detected);
      });
    }
    cvAuc = round(rocAuc(scores, examples.map((e) => e.fraud)), 3);
  }

  const coefficients: Partial<Record<FraudFeature, number>> = {};
  features.forEach((id, j) => (coefficients[id] = round(coefs[j]!)));
  return {
    version: 1,
    label,
    trainedAt: now.toISOString(),
    n: examples.length,
    positives,
    intercept: round(intercept),
    coefficients,
    cvAuc,
  };
}

/** A feature counts as a reason only if it raises the odds by at least 10% (log-odds 0.1); smaller weights are noise. */
export const MIN_REASON_COEFFICIENT = 0.1;

/** Scores one event against one model. Reasons are the features that held and clearly raised the probability. */
export function scoreFraud(model: FraudModel, detected: readonly FraudFeature[]): FraudScore {
  let z = model.intercept;
  const raised: [FraudFeature, number][] = [];
  for (const id of detected) {
    const c = model.coefficients[id];
    if (c === undefined) continue;
    z += c;
    if (c >= MIN_REASON_COEFFICIENT) raised.push([id, c]);
  }
  raised.sort((a, b) => b[1] - a[1]);
  return { label: model.label, probability: round(sigmoid(z), 3), reasons: raised.map(([id]) => id) };
}

/** Signal ids that fired, from evaluated results. */
export function firedSignals(results: Partial<Record<SignalId, { detected: boolean }>>): SignalId[] {
  return SIGNAL_IDS.filter((id) => results[id]?.detected);
}

/** What an event stores that context features read; the server's and the embedded library's events both have it. */
export interface FeatureSource {
  matchKind: string;
  confidence: number;
  createdAt: Date;
  results: Partial<Record<SignalId, { detected: boolean; details?: Record<string, unknown> }>>;
  linkedVisitors?: readonly unknown[] | null;
  timezone?: string | null;
  /** Present when the event carried a linkedId. */
  account?: AccountHistory | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const atLeast = (v: unknown, n: number) => (num(v) ?? -Infinity) >= n;

function localHour(at: Date, timeZone: string): number | null {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at);
    const n = Number.parseInt(h, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Context features that hold for an event. */
export function contextFeatures(e: FeatureSource): ContextFeatureId[] {
  const out: ContextFeatureId[] = [];
  const v = e.results.velocity?.details ?? {};
  const multi = e.results.multiAccount?.details ?? {};
  const sharing = e.results.accountSharing?.details ?? {};
  if (e.matchKind === 'new') out.push('newVisitor');
  if (e.matchKind === 'similar' && e.confidence < 0.8) out.push('weakMatch');
  if (atLeast(v.visitorsPerIp1h, 3)) out.push('sharedIp');
  if (atLeast(v.ipsPerVisitor24h, 3)) out.push('manyIps');
  if (atLeast(v.eventsPerVisitor1h, 5)) out.push('eventBurst');
  if (atLeast(v.visitorsPerLinkedId24h, 2) || atLeast(sharing.devicesForAccount, 2)) out.push('sharedAccount');
  if (atLeast(multi.accountsOnDevice, 2)) out.push('multipleAccounts');
  if ((e.linkedVisitors?.length ?? 0) > 0) out.push('otherBrowsers');
  const hour = e.timezone ? localHour(e.createdAt, e.timezone) : null;
  if (hour !== null && hour < 6) out.push('localNight');
  if (e.account) {
    const first = e.account.firstSeenAt ? Date.parse(e.account.firstSeenAt) : Number.NaN;
    const young = !Number.isFinite(first) || e.createdAt.getTime() - first < 24 * 3_600_000;
    if (young) out.push('newAccount');
    else if (!e.account.seenOnDevice) out.push('newDeviceForAccount');
  }
  return out;
}

/** Every feature a model sees for an event: fired signals, then context features. */
export function fraudFeatures(e: FeatureSource): FraudFeature[] {
  return [...firedSignals(e.results), ...contextFeatures(e)];
}
