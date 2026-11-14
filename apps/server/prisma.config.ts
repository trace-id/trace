import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env by itself. Local development keeps its .env file;
// containers and CI pass real environment variables.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Only migrate needs a URL; `prisma generate` runs without one (CI, Docker builds).
  datasource: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : {},
});
