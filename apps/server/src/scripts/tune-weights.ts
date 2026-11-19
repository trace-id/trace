import '../config/load-dotenv.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SIGNAL_IDS, type SignalId } from '@trace-id/signals/config';
import { type LabeledExample, parseLabels, tuneWeights } from '../accuracy/tune.js';
import { loadScoringConfig } from '../config/scoring.js';
import { createPrismaClient } from '../infra/prisma-client.js';

const USAGE = `Usage: npm run tune -w trace-server -- --labels <file.csv> --out <override.json> [--config <scoring.json>] [--block-score 60] [--min-support 20]

Learns suspect-score weights from your own outcomes. The labels file has one "eventId,label" per line, label being
fraud or legit (for example: accounts you banned, chargebacks, confirmed bots vs accounts in good standing).
Reads the events from DATABASE_URL, fits a logistic regression on which signals fired, and writes a scoring override
with the learned weights. Load it with SCORING_CONFIG_PATH after reviewing the report.`;

const BATCH = 500;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      labels: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      'block-score': { type: 'string' },
      'min-support': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !values.labels || !values.out) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const labels = parseLabels(readFileSync(values.labels, 'utf8'));
  if (labels.size === 0) {
    console.error('No labelled events found in the labels file');
    process.exit(1);
  }
  const config = loadScoringConfig(values.config);
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const examples: LabeledExample[] = [];
  try {
    const ids = [...labels.keys()];
    for (let i = 0; i < ids.length; i += BATCH) {
      const rows = await prisma.event.findMany({ where: { id: { in: ids.slice(i, i + BATCH) } }, select: { id: true, signals: true } });
      for (const row of rows) {
        const results = (row.signals as { results?: Record<string, { detected?: boolean }> } | null)?.results ?? {};
        const detected = Object.fromEntries(SIGNAL_IDS.map((id) => [id, results[id]?.detected === true])) as Record<SignalId, boolean>;
        examples.push({ detected, fraud: labels.get(row.id) === true });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  const missing = labels.size - examples.length;
  const result = tuneWeights(examples, {
    current: config.suspect.weights,
    blockScore: values['block-score'] ? Number(values['block-score']) : 60,
    minSupport: values['min-support'] ? Number(values['min-support']) : 20,
  });

  console.log(`events: ${result.n} (${result.positives} fraud)${missing ? `, ${missing} labelled ids not found (expired by retention?)` : ''}`);
  console.log(`AUC: learned ${result.auc.toFixed(3)}${result.currentAuc !== null ? ` vs current ${result.currentAuc.toFixed(3)}` : ''}`);
  console.log('');
  console.log('signal               fired  fraud%   coef  current -> learned');
  for (const id of SIGNAL_IDS) {
    const s = result.signals[id];
    const rate = s.fraudRate === null ? '   -  ' : `${(s.fraudRate * 100).toFixed(1).padStart(5)}%`;
    const note = result.keptForLowSupport.includes(id) ? '  (kept: too few events)' : '';
    console.log(`${id.padEnd(20)} ${String(s.fired).padStart(5)}  ${rate} ${s.coefficient.toFixed(2).padStart(6)}  ${String(config.suspect.weights[id]).padStart(7)} -> ${s.weight}${note}`);
  }
  const override = { ...config, suspect: { weights: result.weights } };
  writeFileSync(values.out, `${JSON.stringify(override, null, 2)}\n`);
  console.log(`\nwrote ${values.out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
