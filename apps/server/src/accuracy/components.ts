import { type IdentificationConfig } from '@trace-id/signals/config';
import { COMPONENT_NAMES, type ComponentName } from '@trace-id/signals/types';
import { type Fixture, runFixture } from './harness.js';

/**
 * Which components earn their weight. For each component, on a labelled fixture:
 *  - coverage: share of sessions that report it
 *  - stability: share of a device's consecutive sessions where its value did not change (higher = more reliable)
 *  - distinctness: distinct values divided by devices, from each device's first session (higher = tells devices apart)
 *  - f1Without: F1 of the whole engine when the component is removed, and `f1Drop` against the full result.
 *    A drop near zero means the component adds nothing here; negative means removing it helps (its weight is too high
 *    or it is noisy). Synthetic fixtures only show what the generator models, so use real labelled data to decide.
 */
export interface ComponentStats {
  component: ComponentName;
  coverage: number;
  stability: number | null;
  distinctness: number | null;
  f1Without: number;
  f1Drop: number;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export async function componentReport(fixture: Fixture, config: IdentificationConfig): Promise<ComponentStats[]> {
  const full = await runFixture(fixture, config);
  const lastByDevice = new Map<string, Record<string, string | undefined>>();
  const firstValues = new Map<string, Set<string>>();
  const seenFirst = new Set<string>();
  const present = new Map<string, number>();
  const same = new Map<string, number>();
  const compared = new Map<string, number>();

  for (const s of fixture.sessions) {
    const prev = lastByDevice.get(s.device);
    const isFirst = !seenFirst.has(s.device);
    seenFirst.add(s.device);
    for (const name of COMPONENT_NAMES) {
      const v = s.components[name];
      if (v !== undefined) present.set(name, (present.get(name) ?? 0) + 1);
      if (isFirst && v !== undefined) {
        let set = firstValues.get(name);
        if (!set) firstValues.set(name, (set = new Set()));
        set.add(v);
      }
      if (prev && v !== undefined && prev[name] !== undefined) {
        compared.set(name, (compared.get(name) ?? 0) + 1);
        if (prev[name] === v) same.set(name, (same.get(name) ?? 0) + 1);
      }
    }
    lastByDevice.set(s.device, { ...(prev ?? {}), ...s.components });
  }

  const results: ComponentStats[] = [];
  for (const name of COMPONENT_NAMES) {
    if (!present.has(name)) continue;
    const without: Fixture = {
      ...fixture,
      sessions: fixture.sessions.map((s) => {
        const { [name]: _removed, ...rest } = s.components;
        return { ...s, components: rest };
      }),
    };
    const f1 = (await runFixture(without, config)).f1;
    const c = compared.get(name) ?? 0;
    results.push({
      component: name,
      coverage: round4((present.get(name) ?? 0) / fixture.sessions.length),
      stability: c === 0 ? null : round4((same.get(name) ?? 0) / c),
      distinctness: full.devices === 0 ? null : round4((firstValues.get(name)?.size ?? 0) / full.devices),
      f1Without: f1,
      f1Drop: round4(full.f1 - f1),
    });
  }
  return results.sort((a, b) => b.f1Drop - a.f1Drop);
}
