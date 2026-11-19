import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadScoringConfig } from '../config/scoring.js';
import { BASELINE_PATH, loadFixtures } from './fixtures.js';
import { componentReport } from './components.js';
import { type AccuracyReport, type Fixture, runFixture } from './harness.js';

const TOLERANCE = 0.005;

type Baseline = Record<string, { precision: number; recall: number }>;

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printReport(r: AccuracyReport): void {
  console.log(`\n${r.fixture}${r.synthetic ? ' (synthetic)' : ''}`);
  console.log(
    `  sessions=${r.sessions} devices=${r.devices} visitors=${r.visitors}  precision=${pct(r.precision)} recall=${pct(r.recall)} f1=${pct(r.f1)} falseMerge=${pct(r.falseMergeRate)} indistinguishable=${pct(r.indistinguishableRate)}`,
  );
  for (const [scenario, s] of Object.entries(r.byScenario).sort()) {
    console.log(`    ${scenario.padEnd(18)} ${String(s.correct).padStart(5)}/${String(s.sessions).padEnd(5)} ${pct(s.correct / s.sessions)}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'update-baseline': { type: 'boolean' },
      json: { type: 'string' },
      config: { type: 'string' },
      components: { type: 'boolean' },
      fixture: { type: 'string' },
    },
  });
  const config = loadScoringConfig(values.config);
  if (values.components) {
    // Per-component diagnostic. Pass --fixture <file.json> (a labelled Fixture exported from your own data) to use real data.
    const fixtures = values.fixture ? [JSON.parse(readFileSync(values.fixture, 'utf8')) as Fixture] : loadFixtures().slice(-1);
    for (const fixture of fixtures) {
      console.log(`
${fixture.name}${fixture.synthetic ? ' (synthetic: shows only what the generator models)' : ''}`);
      console.log('  component        coverage  stability  distinct  f1 drop when removed');
      for (const c of await componentReport(fixture, config.identification)) {
        const p = (n: number | null): string => (n === null ? '   n/a' : pct(n).padStart(6));
        console.log(`  ${c.component.padEnd(16)} ${pct(c.coverage).padStart(7)}  ${p(c.stability)}    ${p(c.distinctness)}   ${(c.f1Drop * 100).toFixed(2)} pts`);
      }
    }
    return;
  }
  const reports: AccuracyReport[] = [];
  for (const fixture of loadFixtures()) reports.push(await runFixture(fixture, config.identification));
  reports.forEach(printReport);

  if (values.json) writeFileSync(values.json, `${JSON.stringify(reports, null, 2)}\n`);

  if (values['update-baseline']) {
    const baseline: Baseline = Object.fromEntries(
      reports.map((r) => [r.fixture, { precision: r.precision, recall: r.recall }]),
    );
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`\nbaseline written to ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  const regressions: string[] = [];
  for (const r of reports) {
    const b = baseline[r.fixture];
    if (!b) {
      regressions.push(`${r.fixture}: no baseline (run with --update-baseline)`);
      continue;
    }
    if (r.precision < b.precision - TOLERANCE) regressions.push(`${r.fixture}: precision ${pct(r.precision)} < ${pct(b.precision)}`);
    if (r.recall < b.recall - TOLERANCE) regressions.push(`${r.fixture}: recall ${pct(r.recall)} < ${pct(b.recall)}`);
  }
  if (regressions.length > 0) {
    console.error(`\nAccuracy regression:\n  ${regressions.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nNo regression against baseline.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
