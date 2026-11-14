import { type IdentificationConfig } from './config.js';
import { COMPONENT_NAMES, type Components } from './types.js';

/**
 * Weighted share of matching components among those both sides reported.
 * Returns 0 when the overlap is too small to say anything (below minSharedWeightRatio
 * of the total configured weight), so sparse payloads cannot match by accident.
 */
export function componentSimilarity(
  a: Components,
  b: Components,
  config: Pick<IdentificationConfig, 'componentWeights' | 'minSharedWeightRatio'>,
): number {
  let totalWeight = 0;
  let sharedWeight = 0;
  let matchedWeight = 0;
  for (const name of COMPONENT_NAMES) {
    const weight = config.componentWeights[name] ?? 0;
    if (weight <= 0) continue;
    totalWeight += weight;
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) continue;
    sharedWeight += weight;
    if (left === right) matchedWeight += weight;
  }
  if (totalWeight === 0 || sharedWeight / totalWeight < config.minSharedWeightRatio) {
    return 0;
  }
  return matchedWeight / sharedWeight;
}
