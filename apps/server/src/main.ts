import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { parseEnv } from './config/env.js';
import { loadScoringConfig } from './config/scoring.js';
import { ListIpIntelProvider } from './intel/ip-intel.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const logger = new Logger('Main');
  const ipIntel = ListIpIntelProvider.fromFiles({
    torExitListFile: env.TOR_EXIT_LIST_FILE,
    datacenterCidrFile: env.DATACENTER_CIDR_FILE,
    blocklistFile: env.IP_BLOCKLIST_FILE,
  });
  const sizes = ipIntel.sizes;
  logger.log(`ip lists loaded: tor=${sizes.tor} datacenter=${sizes.datacenter} blocklist=${sizes.blocklist}`);

  const app = await createApp({ env, scoring: loadScoringConfig(env.SCORING_CONFIG_PATH), ipIntel });
  await app.listen(env.PORT, env.HOST);
  logger.log(`listening on ${env.HOST}:${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
