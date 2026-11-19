import { COMPONENT_NAMES, type ComponentName, type Components } from './types.js';

/**
 * Probabilistic record linkage (Fellegi-Sunter) for visitor matching. For each component both sides report:
 *
 *   equal values:     + ln( (1 - change) / frequency )   a rare shared value is strong evidence, a common one weak
 *   different values: + ln( change / (1 - frequency) )   a volatile component (CSS support after an update) costs
 *                                                         little, a stable one (GPU) costs a lot
 *
 * `change` is how often the component differs between two visits of the same browser; `frequency` is how common the
 * value is among the project's visitors (smoothed towards a prior, so a young project with few visitors is not
 * overconfident). The sum is the log-likelihood ratio "same browser" vs "different browser"; with the prior odds it
 * gives a probability. Components are correlated (canvas, WebGL and audio all follow the GPU), so evidence is damped.
 */

export interface LinkageConfig {
  /** P(the component differs between two visits of the same browser). */
  changeRate: Partial<Record<ComponentName, number>>;
  /** Prior share of visitors with a given value, used before the project has its own statistics. */
  priorFrequency: Partial<Record<ComponentName, number>>;
  /** How many visitors' worth of weight the prior carries in the smoothed frequency. */
  priorStrength: number;
  /** Multiplier on the summed evidence, for correlated components. */
  dependence: number;
  /** Added to the prior log-odds (below); negative values make matching stricter. */
  priorLogOdds: number;
  /**
   * Share of visits that come from a returning browser. The prior that one candidate is the match is this share split
   * over the candidates scored, so a young project with one candidate is not judged like one with fifty.
   */
  returningRate: number;
  /** Lowest probability that counts as the same visitor. */
  matchProbability: number;
  /** Fewest components both sides must report. */
  minSharedComponents: number;
  /**
   * Correlated components (all following the GPU, the browser build or the locale). Within a group only the strongest
   * agreement counts, so one fact is not counted five times; every disagreement still counts. Components in no group
   * stand alone.
   */
  groups: ComponentName[][];
}

export const DEFAULT_LINKAGE_CONFIG: LinkageConfig = {
  changeRate: {
    canvas: 0.05, webgl: 0.02, webglParams: 0.15, audio: 0.05, fonts: 0.05, screen: 0.1, hardware: 0.02,
    timezone: 0.05, languages: 0.03, platform: 0.01, math: 0.02, css: 0.3, media: 0.1, userAgentFamily: 0.01,
    intl: 0.03, textMetrics: 0.1, webglRender: 0.05, webgpu: 0.1, apiSurface: 0.3, systemStyle: 0.05, codecs: 0.1,
    webgl2: 0.15, extensions: 0.25, appInstall: 0.02,
  },
  priorFrequency: {
    canvas: 0.02, webgl: 0.05, webglParams: 0.05, audio: 0.1, fonts: 0.2, screen: 0.1, hardware: 0.15,
    timezone: 0.1, languages: 0.2, platform: 0.4, math: 0.3, css: 0.2, media: 0.2, userAgentFamily: 0.3,
    intl: 0.15, textMetrics: 0.05, webglRender: 0.03, webgpu: 0.1, apiSurface: 0.2, systemStyle: 0.15, codecs: 0.2,
    webgl2: 0.05, extensions: 0.3,
    // A per-install id: practically unique, so agreeing on it is strong evidence.
    appInstall: 0.0001,
  },
  priorStrength: 20,
  dependence: 0.85,
  priorLogOdds: -2,
  returningRate: 0.5,
  matchProbability: 0.97,
  minSharedComponents: 6,
  groups: [
    ['canvas', 'webgl', 'webglParams', 'webglRender', 'webgpu', 'webgl2', 'audio'],
    ['math', 'css', 'media', 'apiSurface', 'codecs', 'userAgentFamily', 'platform', 'systemStyle'],
    ['intl', 'languages'],
    ['fonts', 'textMetrics'],
  ],
};

/** How common each component value is in this project. */
export interface FrequencyTable {
  /** Visitors counted. */
  total: number;
  /** Visitors with this value; keyed `${component}:${value}`. */
  count(component: ComponentName, value: string): number;
}

export const EMPTY_FREQUENCIES: FrequencyTable = { total: 0, count: () => 0 };

export interface LinkageScore {
  logLikelihoodRatio: number;
  probability: number;
  shared: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function smoothedFrequency(table: FrequencyTable, component: ComponentName, value: string, config: LinkageConfig): number {
  const prior = config.priorFrequency[component] ?? 0.1;
  const f = (table.count(component, value) + config.priorStrength * prior) / (table.total + config.priorStrength);
  return clamp(f, 1e-4, 0.999);
}

/** Prior log-odds that one of `candidates` scored candidates is the returning browser. */
export function candidatePrior(candidates: number, config: LinkageConfig): number {
  const p = clamp(config.returningRate / Math.max(1, candidates), 1e-6, 0.999);
  return Math.log(p / (1 - p)) + config.priorLogOdds;
}

export function linkageScore(
  a: Components,
  b: Components,
  table: FrequencyTable,
  config: LinkageConfig,
  candidates = 1,
): LinkageScore {
  const groupOf = new Map<ComponentName, number>();
  config.groups.forEach((members, i) => members.forEach((m) => groupOf.set(m, i)));
  const bestAgreement = new Map<string, number>();
  let llr = 0;
  let shared = 0;
  for (const name of COMPONENT_NAMES) {
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) continue;
    shared++;
    const change = clamp(config.changeRate[name] ?? 0.1, 0.001, 0.9);
    const freq = smoothedFrequency(table, name, left, config);
    if (left === right) {
      const key = groupOf.has(name) ? `g${groupOf.get(name)}` : name;
      bestAgreement.set(key, Math.max(bestAgreement.get(key) ?? -Infinity, Math.log((1 - change) / freq)));
    } else {
      llr += Math.log(change / (1 - freq));
    }
  }
  for (const v of bestAgreement.values()) llr += v;
  if (shared < config.minSharedComponents) return { logLikelihoodRatio: 0, probability: 0, shared };
  const damped = llr * config.dependence;
  return { logLikelihoodRatio: damped, probability: sigmoid(damped + candidatePrior(candidates, config)), shared };
}
