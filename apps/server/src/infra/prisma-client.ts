import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface DbOptions {
  /** Server-side cap per statement. Default 5000 ms. */
  statementTimeoutMs?: number;
  /** Connections per process. Default 10. */
  poolMax?: number;
}

/**
 * Prisma 7 talks to Postgres through the pg driver. Every connection gets a statement
 * timeout so a slow or locked database fails requests quickly instead of piling them up,
 * and connecting gives up after 5 s.
 */
export function prismaOptions(url: string, opts: DbOptions = {}): { adapter: PrismaPg } {
  return {
    adapter: new PrismaPg({
      connectionString: url,
      max: opts.poolMax ?? 10,
      statement_timeout: opts.statementTimeoutMs ?? 5000,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      // The adapter sends timestamps without an offset, so Postgres reads them in the session
      // timezone. Pinning UTC keeps stored instants correct whatever the server's TimeZone is.
      options: '-c TimeZone=UTC',
    }),
  };
}

export function createPrismaClient(url: string, opts: DbOptions = {}): PrismaClient {
  return new PrismaClient(prismaOptions(url, opts));
}
