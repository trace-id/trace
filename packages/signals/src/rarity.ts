import { type FrequencyTable } from './linkage.js';
import { type ComponentName, type Components } from './types.js';

/** Hardware-side components: what the device is, not how the browser is configured. */
export const RARE_COMPONENTS: readonly ComponentName[] = ['webgl', 'webglParams', 'screen', 'hardware', 'platform'];

export interface DeviceRarity {
  /** Visitors in the project's statistics. */
  total: number;
  /** Estimated share of visitors with this combination: the product of each component's share (smoothed). */
  share: number;
  /** Each component's share on its own, for the explanation. */
  components: Partial<Record<ComponentName, number>>;
}

/**
 * How unusual the device's hardware is in this project. Treats components as independent, which overstates rarity for
 * values that go together (a GPU and the screens it usually drives), hence the conservative default threshold.
 */
export function deviceRarity(components: Components, table: FrequencyTable): DeviceRarity | null {
  if (table.total <= 0) return null;
  let share = 1;
  const parts: Partial<Record<ComponentName, number>> = {};
  for (const name of RARE_COMPONENTS) {
    const value = components[name];
    if (typeof value !== 'string') continue;
    // +1 smoothing: a value never counted is rare, not impossible.
    const s = (table.count(name, value) + 1) / (table.total + 1);
    parts[name] = Math.round(s * 10_000) / 10_000;
    share *= s;
  }
  if (Object.keys(parts).length === 0) return null;
  return { total: table.total, share, components: parts };
}
