import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { describe, expect, it } from 'vitest';
import { componentReport } from './components.js';
import { syntheticPopulation } from './synthetic.js';

const cfg = TEST_SCORING_CONFIG.identification;

describe('componentReport', () => {
  it('reports coverage, stability and the F1 drop for each reported component, most useful first', async () => {
    const report = await componentReport(syntheticPopulation(3, 80), cfg);
    expect(report.length).toBeGreaterThan(5);
    for (const r of report) {
      expect(r.coverage).toBeGreaterThan(0);
      expect(r.coverage).toBeLessThanOrEqual(1);
      if (r.stability !== null) expect(r.stability).toBeLessThanOrEqual(1);
    }
    const drops = report.map((r) => r.f1Drop);
    expect(drops).toEqual([...drops].sort((a, b) => b - a));
  });

  it('is deterministic', async () => {
    const a = await componentReport(syntheticPopulation(3, 40), cfg);
    expect(await componentReport(syntheticPopulation(3, 40), cfg)).toEqual(a);
  });
});
