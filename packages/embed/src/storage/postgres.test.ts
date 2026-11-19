import { afterAll, describe, it } from 'vitest';
import { storageContract } from './contract.js';
import { type PgLike, postgresStorage } from './postgres.js';

/**
 * Runs the storage contract against a real Postgres when PG_URL_TEST is set. Each test uses its own table prefix, and
 * the tables are dropped afterwards. Without it the suite is skipped.
 */
const url = process.env.PG_URL_TEST;

if (!url) {
  describe.skip('storage contract: postgres (set PG_URL_TEST to run)', () => it('skipped', () => {}));
} else {
  // Loaded only when a test database is configured, so the package needs no pg dependency.
  const pg = (await import(/* @vite-ignore */ 'pg' as string)) as { default: { Pool: new (o: { connectionString: string }) => PgLike & { end(): Promise<void> } } };
  const pool = new pg.default.Pool({ connectionString: url });
  const prefixes: string[] = [];
  let n = 0;
  storageContract('postgres', async () => {
    const prefix = `tc${process.pid}_${n++}_`;
    prefixes.push(prefix);
    return postgresStorage(pool, { prefix });
  });
  afterAll(async () => {
    for (const p of prefixes) {
      for (const table of ['visitors', 'buckets', 'profiles', 'accounts', 'events']) await pool.query(`DROP TABLE IF EXISTS "${p}${table}"`);
    }
    await pool.end();
  });
}
