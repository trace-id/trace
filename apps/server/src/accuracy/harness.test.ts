import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from './fixtures.js';
import { type Fixture, runFixture } from './harness.js';
import { syntheticPopulation } from './synthetic.js';

const cfg = TEST_SCORING_CONFIG.identification;

describe('accuracy harness', () => {
  it('passes every Phase 1 acceptance case', async () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, 'acceptance.json'), 'utf8')) as Fixture;
    const r = await runFixture(fixture, cfg);
    expect(r.byScenario.incognito).toEqual({ sessions: 5, correct: 5 });
    expect(r).toMatchObject({ precision: 1, recall: 1, falseMergeRate: 0, devices: 5, visitors: 5 });
  });

  it('is deterministic', async () => {
    const a = await runFixture(syntheticPopulation(7, 50), cfg);
    const b = await runFixture(syntheticPopulation(7, 50), cfg);
    expect(a).toEqual(b);
  });

  it('scores a perfect split and a total merge correctly', async () => {
    // The 14 components every SDK version reports, enough overlap (minSharedWeightRatio) to be compared at all.
    const comps = {
      canvas: 'c', webgl: 'w', webglParams: 'wp', audio: 'a', fonts: 'f', screen: 's', hardware: 'h', timezone: 't',
      languages: 'l', platform: 'p', math: 'm', css: 'cs', media: 'md', userAgentFamily: 'u',
    };
    const fixture: Fixture = {
      name: 'merge',
      description: '',
      synthetic: true,
      sessions: [
        { id: '1', device: 'x', profile: 'x1', scenario: 'first', components: comps },
        { id: '2', device: 'y', profile: 'y1', scenario: 'first', components: comps },
      ],
    };
    const r = await runFixture(fixture, cfg);
    expect(r).toMatchObject({ precision: 0, recall: 1, falseMergeRate: 0.5, visitors: 1 });
  });
});
