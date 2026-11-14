import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Fixture } from './harness.js';
import { syntheticPopulation } from './synthetic.js';

export const FIXTURE_DIR = fileURLToPath(new URL('../../test/fixtures/accuracy/', import.meta.url));
export const BASELINE_PATH = join(FIXTURE_DIR, 'baseline.json');

/** Labeled JSON fixtures in test/fixtures/accuracy plus the generated synthetic population. */
export function loadFixtures(): Fixture[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'baseline.json')
    .sort();
  const labeled = files.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture);
  return [...labeled, syntheticPopulation(1, 300), syntheticPopulation(2, 1000)];
}
