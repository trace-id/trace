/* eslint-disable @typescript-eslint/no-explicit-any */
import { type StoredEvent } from '../event.js';
import { type FraudFeature, type FraudModel } from '@trace-id/signals/fraud-score';
import { type AccountRecord, type DeviceProfileRecord, type LabelRecord, type TraceStorage, type VisitorRecord } from '../storage.js';

/** The part of a `pg` Pool (or Client) this uses. Works with node-postgres; other drivers can be wrapped to match. */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  /** A Pool's connect(), used to run the per-identification write in one transaction. Optional. */
  connect?(): Promise<{ query: PgLike['query']; release(): void }>;
}

export interface PostgresStorageOptions {
  /** Table name prefix, so Trace's tables sit beside yours. Default "trace_". Letters, digits and _ only. */
  prefix?: string;
  /** Postgres schema. Default "public". */
  schema?: string;
}

/**
 * Trace data in the Postgres you already run: seven tables (two for the fraud score), created by init() if missing (no migration tool needed).
 * The write per identification runs in one transaction when you pass a Pool.
 *
 *   import pg from 'pg';
 *   const storage = postgresStorage(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 */
export function postgresStorage(db: PgLike, opts: PostgresStorageOptions = {}): TraceStorage {
  const prefix = opts.prefix ?? 'trace_';
  const schema = opts.schema ?? 'public';
  if (!/^\w*$/.test(prefix) || !/^\w+$/.test(schema)) throw new Error('postgresStorage: prefix and schema must be letters, digits or _');
  const t = (name: string) => `"${schema}"."${prefix}${name}"`;
  const V = t('visitors'), B = t('buckets'), P = t('profiles'), A = t('accounts'), E = t('events'), L = t('labels'), M = t('fraud_models');

  const toVisitor = (r: any): VisitorRecord => ({
    id: r.id,
    deviceId: r.device_id,
    firstSeenAt: new Date(r.first_seen_at),
    lastSeenAt: new Date(r.last_seen_at),
    components: r.components ?? {},
    eventCount: Number(r.event_count),
  });
  const toProfile = (r: any): DeviceProfileRecord => ({
    visitorId: r.visitor_id,
    netHash: r.net_hash,
    coreHash: r.core_hash,
    browser: r.browser,
    profile: r.profile,
    lastSeenAt: new Date(r.last_seen_at),
  });
  const toAccount = (r: any): AccountRecord => ({ visitorId: r.visitor_id, linkedId: r.linked_id, firstSeenAt: new Date(r.first_seen_at), lastSeenAt: new Date(r.last_seen_at) });
  const toLabel = (r: any): LabelRecord => ({
    eventId: r.event_id,
    label: r.label,
    fraud: r.fraud,
    visitorId: r.visitor_id,
    detected: (r.detected ?? []) as FraudFeature[],
    updatedAt: new Date(r.updated_at),
  });
  const toEvent = (r: any): StoredEvent => ({ ...r.data, id: r.id, visitorId: r.visitor_id, createdAt: new Date(r.created_at) });

  return {
    async init() {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${V} (id text PRIMARY KEY, device_id text, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, components jsonb NOT NULL DEFAULT '{}', event_count integer NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS "${prefix}visitors_device" ON ${V} (device_id, last_seen_at DESC);
        CREATE TABLE IF NOT EXISTS ${B} (hash text NOT NULL, visitor_id text NOT NULL, PRIMARY KEY (hash, visitor_id));
        CREATE INDEX IF NOT EXISTS "${prefix}buckets_visitor" ON ${B} (visitor_id);
        CREATE TABLE IF NOT EXISTS ${P} (visitor_id text NOT NULL, net_hash text NOT NULL, core_hash text, browser text NOT NULL, profile jsonb, last_seen_at timestamptz NOT NULL, PRIMARY KEY (visitor_id, net_hash));
        CREATE INDEX IF NOT EXISTS "${prefix}profiles_net" ON ${P} (net_hash, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS "${prefix}profiles_core" ON ${P} (core_hash) WHERE core_hash IS NOT NULL;
        CREATE TABLE IF NOT EXISTS ${A} (visitor_id text NOT NULL, linked_id text NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, PRIMARY KEY (visitor_id, linked_id));
        CREATE INDEX IF NOT EXISTS "${prefix}accounts_linked" ON ${A} (linked_id, last_seen_at DESC);
        CREATE TABLE IF NOT EXISTS ${E} (id uuid PRIMARY KEY, visitor_id text NOT NULL, created_at timestamptz NOT NULL, data jsonb NOT NULL);
        CREATE INDEX IF NOT EXISTS "${prefix}events_visitor" ON ${E} (visitor_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS ${L} (event_id uuid NOT NULL, label text NOT NULL, fraud boolean NOT NULL, visitor_id text NOT NULL, detected text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL, PRIMARY KEY (event_id, label));
        CREATE INDEX IF NOT EXISTS "${prefix}labels_label" ON ${L} (label, updated_at DESC);
        CREATE INDEX IF NOT EXISTS "${prefix}labels_visitor" ON ${L} (visitor_id);
        CREATE TABLE IF NOT EXISTS ${M} (label text PRIMARY KEY, model jsonb NOT NULL, trained_at timestamptz NOT NULL);
      `);
    },
    async visitor(id) {
      const { rows } = await db.query(`SELECT * FROM ${V} WHERE id = $1`, [id]);
      return rows[0] ? toVisitor(rows[0]) : null;
    },
    async visitors(ids) {
      if (ids.length === 0) return [];
      return (await db.query(`SELECT * FROM ${V} WHERE id = ANY($1::text[])`, [[...new Set(ids)]])).rows.map(toVisitor);
    },
    async visitorIdsInBuckets(hashes, limit) {
      const { rows } = await db.query(`SELECT DISTINCT visitor_id FROM ${B} WHERE hash = ANY($1::text[]) ORDER BY visitor_id LIMIT $2`, [hashes, limit]);
      return rows.map((r) => r.visitor_id as string);
    },
    async visitorsOnDevice(deviceId, limit) {
      return (await db.query(`SELECT * FROM ${V} WHERE device_id = $1 OR id = $1 ORDER BY last_seen_at DESC LIMIT $2`, [deviceId, limit])).rows.map(toVisitor);
    },
    async networksOfVisitor(visitorId, since, limit) {
      const { rows } = await db.query(`SELECT net_hash FROM ${P} WHERE visitor_id = $1 AND last_seen_at >= $2 ORDER BY last_seen_at DESC LIMIT $3`, [visitorId, since, limit]);
      return rows.map((r) => r.net_hash as string);
    },
    async profilesOnNetworks(networks, excludeVisitorId, since, limit) {
      const { rows } = await db.query(
        `SELECT * FROM ${P} WHERE net_hash = ANY($1::text[]) AND visitor_id <> $2 AND last_seen_at >= $3 ORDER BY last_seen_at DESC LIMIT $4`,
        [networks, excludeVisitorId, since, limit],
      );
      return rows.map(toProfile);
    },
    async visitorsPerNetwork(networks, since) {
      const { rows } = await db.query(`SELECT net_hash, count(*)::int AS n FROM ${P} WHERE net_hash = ANY($1::text[]) AND last_seen_at >= $2 GROUP BY net_hash`, [networks, since]);
      return new Map(rows.map((r) => [r.net_hash as string, Number(r.n)]));
    },
    async visitorIdsWithCore(coreHash, excludeVisitorId, limit) {
      const { rows } = await db.query(`SELECT DISTINCT visitor_id FROM ${P} WHERE core_hash = $1 AND visitor_id <> $2 LIMIT $3`, [coreHash, excludeVisitorId, limit]);
      return rows.map((r) => r.visitor_id as string);
    },
    async profilesOfVisitors(ids, limit) {
      if (ids.length === 0) return [];
      return (await db.query(`SELECT * FROM ${P} WHERE visitor_id = ANY($1::text[]) ORDER BY last_seen_at DESC LIMIT $2`, [ids, limit])).rows.map(toProfile);
    },
    async linkedIdsOfVisitors(ids, since, limit) {
      if (ids.length === 0) return [];
      const { rows } = await db.query(`SELECT DISTINCT linked_id FROM ${A} WHERE visitor_id = ANY($1::text[]) AND last_seen_at >= $2 LIMIT $3`, [ids, since, limit]);
      return rows.map((r) => r.linked_id as string);
    },
    async visitorIdsOfLinkedId(linkedId, since, excludeVisitorId, limit) {
      const { rows } = await db.query(`SELECT visitor_id FROM ${A} WHERE linked_id = $1 AND last_seen_at >= $2 AND visitor_id <> $3 LIMIT $4`, [linkedId, since, excludeVisitorId, limit]);
      return rows.map((r) => r.visitor_id as string);
    },
    async accountsOfVisitors(ids, limit) {
      if (ids.length === 0) return [];
      return (await db.query(`SELECT * FROM ${A} WHERE visitor_id = ANY($1::text[]) ORDER BY last_seen_at DESC LIMIT $2`, [ids, limit])).rows.map(toAccount);
    },
    async saveIdentification(w) {
      const run = async (q: PgLike['query']) => {
        await q(
          `INSERT INTO ${V} (id, device_id, first_seen_at, last_seen_at, components, event_count) VALUES ($1, $2, $3, $3, $4, 1)
           ON CONFLICT (id) DO UPDATE SET device_id = EXCLUDED.device_id, last_seen_at = EXCLUDED.last_seen_at, components = EXCLUDED.components, event_count = ${V}.event_count + 1`,
          [w.visitor.id, w.visitor.deviceId, w.now, JSON.stringify(w.visitor.components)],
        );
        if (w.buckets.length > 0) {
          await q(`INSERT INTO ${B} (hash, visitor_id) SELECT unnest($1::text[]), $2 ON CONFLICT DO NOTHING`, [w.buckets, w.visitor.id]);
        }
        if (w.profile) {
          const p = w.profile;
          await q(
            `INSERT INTO ${P} (visitor_id, net_hash, core_hash, browser, profile, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (visitor_id, net_hash) DO UPDATE SET core_hash = EXCLUDED.core_hash, browser = EXCLUDED.browser, profile = EXCLUDED.profile, last_seen_at = EXCLUDED.last_seen_at`,
            [p.visitorId, p.netHash, p.coreHash, p.browser, JSON.stringify(p.profile ?? null), w.now],
          );
        }
        if (w.account) {
          await q(
            `INSERT INTO ${A} (visitor_id, linked_id, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $3)
             ON CONFLICT (visitor_id, linked_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
            [w.account.visitorId, w.account.linkedId, w.now],
          );
        }
        const { id, visitorId, createdAt, ...data } = w.event;
        await q(`INSERT INTO ${E} (id, visitor_id, created_at, data) VALUES ($1, $2, $3, $4)`, [id, visitorId, createdAt, JSON.stringify(data)]);
      };
      if (!db.connect) return run((text, values) => db.query(text, values));
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await run((text, values) => client.query(text, values));
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async event(id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return null;
      const { rows } = await db.query(`SELECT * FROM ${E} WHERE id = $1`, [id]);
      return rows[0] ? toEvent(rows[0]) : null;
    },
    async eventsOfVisitor(visitorId, limit, before) {
      const { rows } = before
        ? await db.query(`SELECT * FROM ${E} WHERE visitor_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3`, [visitorId, before, limit])
        : await db.query(`SELECT * FROM ${E} WHERE visitor_id = $1 ORDER BY created_at DESC LIMIT $2`, [visitorId, limit]);
      return rows.map(toEvent);
    },
    async deleteVisitor(visitorId) {
      const res = await db.query(`DELETE FROM ${V} WHERE id = $1`, [visitorId]);
      await db.query(`DELETE FROM ${B} WHERE visitor_id = $1`, [visitorId]);
      await db.query(`DELETE FROM ${P} WHERE visitor_id = $1`, [visitorId]);
      await db.query(`DELETE FROM ${A} WHERE visitor_id = $1`, [visitorId]);
      await db.query(`DELETE FROM ${E} WHERE visitor_id = $1`, [visitorId]);
      await db.query(`DELETE FROM ${L} WHERE visitor_id = $1`, [visitorId]);
      return (res.rowCount ?? 0) > 0;
    },
    async saveLabel(l) {
      await db.query(
        `INSERT INTO ${L} (event_id, label, fraud, visitor_id, detected, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (event_id, label) DO UPDATE SET fraud = EXCLUDED.fraud, detected = EXCLUDED.detected, updated_at = EXCLUDED.updated_at`,
        [l.eventId, l.label, l.fraud, l.visitorId, l.detected, l.updatedAt],
      );
    },
    async deleteLabel(eventId, label) {
      if (!/^[0-9a-f-]{36}$/.test(eventId)) return false;
      const res = await db.query(`DELETE FROM ${L} WHERE event_id = $1 AND label = $2`, [eventId, label]);
      return (res.rowCount ?? 0) > 0;
    },
    async labels(label, limit) {
      return (await db.query(`SELECT * FROM ${L} WHERE label = $1 ORDER BY updated_at DESC LIMIT $2`, [label, limit])).rows.map(toLabel);
    },
    async labelCounts() {
      const { rows } = await db.query(`SELECT label, count(*)::int AS n, count(*) FILTER (WHERE fraud)::int AS positives FROM ${L} GROUP BY label`);
      return rows.map((r) => ({ label: r.label as string, n: Number(r.n), positives: Number(r.positives) }));
    },
    async eventLabels(eventId) {
      if (!/^[0-9a-f-]{36}$/.test(eventId)) return [];
      return (await db.query(`SELECT * FROM ${L} WHERE event_id = $1 ORDER BY label`, [eventId])).rows.map(toLabel);
    },
    async saveFraudModel(m) {
      await db.query(
        `INSERT INTO ${M} (label, model, trained_at) VALUES ($1, $2, $3) ON CONFLICT (label) DO UPDATE SET model = EXCLUDED.model, trained_at = EXCLUDED.trained_at`,
        [m.label, JSON.stringify(m), new Date(m.trainedAt)],
      );
    },
    async deleteFraudModel(label) {
      await db.query(`DELETE FROM ${M} WHERE label = $1`, [label]);
    },
    async fraudModels() {
      return (await db.query(`SELECT model FROM ${M} ORDER BY label`)).rows.map((r) => r.model as FraudModel);
    },
  };
}
