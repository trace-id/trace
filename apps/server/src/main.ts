import './config/load-dotenv.js';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { parseEnv } from './config/env.js';
import { loadScoringConfig } from './config/scoring.js';
import { buildIpIntel } from './intel/build.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const logger = new Logger('Main');
  const { intel: ipIntel, summary } = buildIpIntel(env);
  logger.log(`ip intel: ${summary}`);

  const app = await createApp({ env, scoring: loadScoringConfig(env.SCORING_CONFIG_PATH), ipIntel });
  await app.listen(env.PORT, env.HOST);
  logger.log(`listening on ${env.HOST}:${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
