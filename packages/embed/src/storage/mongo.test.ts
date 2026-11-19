import { describe, it } from 'vitest';
import { storageContract } from './contract.js';
import { mongoStorage, type MongoDbLike } from './mongo.js';

/**
 * Runs the storage contract against a real MongoDB when MONGO_URL_TEST is set (each test gets a fresh, uniquely
 * named database). Without it the suite is skipped, the same way the server's Postgres suites are.
 */
const url = process.env.MONGO_URL_TEST;

if (!url) {
  describe.skip('storage contract: mongo (set MONGO_URL_TEST to run)', () => it('skipped', () => {}));
} else {
  // Loaded only when a test database is configured, so the package needs no mongodb dependency.
  const { MongoClient } = (await import(/* @vite-ignore */ 'mongodb' as string)) as { MongoClient: new (url: string) => { connect(): Promise<void>; db(name: string): MongoDbLike & { dropDatabase(): Promise<void> } } };
  let n = 0;
  storageContract('mongo', async () => {
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db(`trace_contract_${process.pid}_${Date.now()}_${n++}`);
    return mongoStorage(db);
  });
}
