import { existsSync } from 'node:fs';

// Local development reads apps/server/.env; containers and CI pass real environment
// variables and have no such file. Variables already set win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');
