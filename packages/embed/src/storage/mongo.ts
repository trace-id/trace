/* eslint-disable @typescript-eslint/no-explicit-any */
import { type StoredEvent } from '../event.js';
import { type FraudModel } from '@trace-id/signals/fraud-score';
import { type AccountRecord, type DeviceProfileRecord, type LabelRecord, type TraceStorage, type VisitorRecord } from '../storage.js';

/** The part of the official `mongodb` driver's Db this adapter uses, so any driver version from 4.x works. */
export interface MongoDbLike {
  collection(name: string): MongoCollectionLike;
}
export interface MongoCollectionLike {
  findOne(filter: any, options?: any): Promise<any>;
  find(filter: any, options?: any): { toArray(): Promise<any[]> };
  updateOne(filter: any, update: any, options?: any): Promise<any>;
  updateMany(filter: any, update: any, options?: any): Promise<any>;
  insertOne(doc: any): Promise<any>;
  bulkWrite(ops: any[], options?: any): Promise<any>;
  deleteOne(filter: any): Promise<{ deletedCount?: number }>;
  deleteMany(filter: any): Promise<any>;
  aggregate(pipeline: any[]): { toArray(): Promise<any[]> };
  createIndex(spec: any, options?: any): Promise<any>;
}

export interface MongoStorageOptions {
  /** Collection name prefix, so Trace's collections sit beside yours without clashing. Default "trace_". */
  prefix?: string;
  /** Delete events older than this many days (a TTL index; MongoDB removes them for you). Default: keep forever. */
  eventRetentionDays?: number;
}

/**
 * Trace data in the MongoDB you already run: seven collections (visitors, buckets, profiles, accounts, events, labels, fraud_models) with
 * their own indexes. No transactions are needed: writes are ordered so a partial write never breaks matching.
 *
 *   import { MongoClient } from 'mongodb';
 *   const db = new MongoClient(process.env.MONGO_URL).db();
 *   const storage = mongoStorage(db);
 */
export function mongoStorage(db: MongoDbLike, opts: MongoStorageOptions = {}): TraceStorage {
  const p = opts.prefix ?? 'trace_';
  const visitorsC = db.collection(`${p}visitors`);
  const bucketsC = db.collection(`${p}buckets`);
  const profilesC = db.collection(`${p}profiles`);
  const accountsC = db.collection(`${p}accounts`);
  const eventsC = db.collection(`${p}events`);
  const labelsC = db.collection(`${p}labels`);
  const modelsC = db.collection(`${p}fraud_models`);
  const toLabel = (d: any): LabelRecord => ({ eventId: d.eventId, label: d.label, fraud: d.fraud, visitorId: d.visitorId, detected: d.detected ?? [], updatedAt: d.updatedAt });

  const toVisitor = (d: any): VisitorRecord => ({
    id: d._id,
    deviceId: d.deviceId ?? null,
    firstSeenAt: d.firstSeenAt,
    lastSeenAt: d.lastSeenAt,
    components: d.components ?? {},
    eventCount: d.eventCount ?? 0,
  });
  const toProfile = (d: any): DeviceProfileRecord => ({
    visitorId: d.visitorId,
    netHash: d.netHash,
    coreHash: d.coreHash ?? null,
    browser: d.browser,
    profile: d.profile,
    lastSeenAt: d.lastSeenAt,
  });
  const toAccount = (d: any): AccountRecord => ({ visitorId: d.visitorId, linkedId: d.linkedId, firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt });
  const toEvent = (d: any): StoredEvent => {
    const { _id, ...rest } = d;
    return { id: _id, ...rest } as StoredEvent;
  };

  return {
    async init() {
      await Promise.all([
        visitorsC.createIndex({ deviceId: 1, lastSeenAt: -1 }),
        bucketsC.createIndex({ h: 1 }),
        bucketsC.createIndex({ v: 1 }),
        profilesC.createIndex({ netHash: 1, lastSeenAt: -1 }),
        profilesC.createIndex({ visitorId: 1, lastSeenAt: -1 }),
        profilesC.createIndex({ coreHash: 1 }, { sparse: true }),
        accountsC.createIndex({ visitorId: 1, lastSeenAt: -1 }),
        accountsC.createIndex({ linkedId: 1, lastSeenAt: -1 }),
        eventsC.createIndex({ visitorId: 1, createdAt: -1 }),
        labelsC.createIndex({ label: 1, updatedAt: -1 }),
        labelsC.createIndex({ visitorId: 1 }),
        labelsC.createIndex({ eventId: 1 }),
        ...(opts.eventRetentionDays ? [eventsC.createIndex({ createdAt: 1 }, { expireAfterSeconds: Math.round(opts.eventRetentionDays * 86_400) })] : []),
      ]);
    },
    async visitor(id) {
      const d = await visitorsC.findOne({ _id: id });
      return d ? toVisitor(d) : null;
    },
    async visitors(ids) {
      if (ids.length === 0) return [];
      return (await visitorsC.find({ _id: { $in: [...new Set(ids)] } }).toArray()).map(toVisitor);
    },
    async visitorIdsInBuckets(hashes, limit) {
      const rows = await bucketsC.find({ h: { $in: hashes } }, { projection: { v: 1 }, sort: { v: 1 }, limit: limit * hashes.length }).toArray();
      return [...new Set(rows.map((r) => r.v as string))].slice(0, limit);
    },
    async visitorsOnDevice(deviceId, limit) {
      const rows = await visitorsC.find({ $or: [{ deviceId }, { _id: deviceId }] }, { sort: { lastSeenAt: -1 }, limit }).toArray();
      return rows.map(toVisitor);
    },
    async networksOfVisitor(visitorId, since, limit) {
      const rows = await profilesC.find({ visitorId, lastSeenAt: { $gte: since } }, { projection: { netHash: 1 }, sort: { lastSeenAt: -1 }, limit }).toArray();
      return rows.map((r) => r.netHash as string);
    },
    async profilesOnNetworks(networks, excludeVisitorId, since, limit) {
      const rows = await profilesC
        .find({ netHash: { $in: networks }, visitorId: { $ne: excludeVisitorId }, lastSeenAt: { $gte: since } }, { sort: { lastSeenAt: -1 }, limit })
        .toArray();
      return rows.map(toProfile);
    },
    async visitorsPerNetwork(networks, since) {
      const rows = await profilesC
        .aggregate([{ $match: { netHash: { $in: networks }, lastSeenAt: { $gte: since } } }, { $group: { _id: '$netHash', n: { $sum: 1 } } }])
        .toArray();
      return new Map(rows.map((r) => [r._id as string, r.n as number]));
    },
    async visitorIdsWithCore(coreHash, excludeVisitorId, limit) {
      const rows = await profilesC
        .aggregate([{ $match: { coreHash, visitorId: { $ne: excludeVisitorId } } }, { $group: { _id: '$visitorId' } }, { $limit: limit }])
        .toArray();
      return rows.map((r) => r._id as string);
    },
    async profilesOfVisitors(ids, limit) {
      if (ids.length === 0) return [];
      return (await profilesC.find({ visitorId: { $in: ids } }, { sort: { lastSeenAt: -1 }, limit }).toArray()).map(toProfile);
    },
    async linkedIdsOfVisitors(ids, since, limit) {
      if (ids.length === 0) return [];
      const rows = await accountsC
        .aggregate([{ $match: { visitorId: { $in: ids }, lastSeenAt: { $gte: since } } }, { $group: { _id: '$linkedId' } }, { $limit: limit }])
        .toArray();
      return rows.map((r) => r._id as string);
    },
    async visitorIdsOfLinkedId(linkedId, since, excludeVisitorId, limit) {
      const rows = await accountsC
        .find({ linkedId, lastSeenAt: { $gte: since }, visitorId: { $ne: excludeVisitorId } }, { projection: { visitorId: 1 }, limit })
        .toArray();
      return rows.map((r) => r.visitorId as string);
    },
    async accountsOfVisitors(ids, limit) {
      if (ids.length === 0) return [];
      return (await accountsC.find({ visitorId: { $in: ids } }, { sort: { lastSeenAt: -1 }, limit }).toArray()).map(toAccount);
    },
    async saveIdentification(w) {
      // Visitor first: everything else refers to it. The event goes last, so a visible event always has its visitor.
      await visitorsC.updateOne(
        { _id: w.visitor.id },
        {
          $set: { deviceId: w.visitor.deviceId, components: w.visitor.components, lastSeenAt: w.now },
          $setOnInsert: { firstSeenAt: w.now },
          $inc: { eventCount: 1 },
        },
        { upsert: true },
      );
      if (w.buckets.length > 0) {
        await bucketsC.bulkWrite(
          w.buckets.map((h) => ({ updateOne: { filter: { _id: `${h}|${w.visitor.id}` }, update: { $setOnInsert: { h, v: w.visitor.id } }, upsert: true } })),
          { ordered: false },
        );
      }
      if (w.profile) {
        const { visitorId, netHash, coreHash, browser, profile } = w.profile;
        await profilesC.updateOne(
          { _id: `${visitorId}|${netHash}` },
          { $set: { visitorId, netHash, coreHash, browser, profile, lastSeenAt: w.now } },
          { upsert: true },
        );
      }
      if (w.account) {
        const { visitorId, linkedId } = w.account;
        await accountsC.updateOne(
          { _id: `${visitorId}|${linkedId}` },
          { $set: { visitorId, linkedId, lastSeenAt: w.now }, $setOnInsert: { firstSeenAt: w.now } },
          { upsert: true },
        );
      }
      const { id, ...event } = w.event;
      await eventsC.insertOne({ _id: id, ...event });
    },
    async event(id) {
      const d = await eventsC.findOne({ _id: id });
      return d ? toEvent(d) : null;
    },
    async eventsOfVisitor(visitorId, limit, before) {
      const filter: any = { visitorId };
      if (before) filter.createdAt = { $lt: before };
      return (await eventsC.find(filter, { sort: { createdAt: -1 }, limit }).toArray()).map(toEvent);
    },
    async deleteVisitor(visitorId) {
      const res = await visitorsC.deleteOne({ _id: visitorId });
      await Promise.all([
        bucketsC.deleteMany({ v: visitorId }),
        profilesC.deleteMany({ visitorId }),
        accountsC.deleteMany({ visitorId }),
        eventsC.deleteMany({ visitorId }),
        labelsC.deleteMany({ visitorId }),
      ]);
      return (res.deletedCount ?? 0) > 0;
    },
    async saveLabel(l) {
      const { eventId, label, ...rest } = l;
      await labelsC.updateOne({ _id: `${eventId}|${label}` }, { $set: { eventId, label, ...rest } }, { upsert: true });
    },
    async deleteLabel(eventId, label) {
      return ((await labelsC.deleteOne({ _id: `${eventId}|${label}` })).deletedCount ?? 0) > 0;
    },
    async labels(label, limit) {
      return (await labelsC.find({ label }, { sort: { updatedAt: -1 }, limit }).toArray()).map(toLabel);
    },
    async labelCounts() {
      const rows = await labelsC.aggregate([{ $group: { _id: '$label', n: { $sum: 1 }, positives: { $sum: { $cond: ['$fraud', 1, 0] } } } }]).toArray();
      return rows.map((r) => ({ label: r._id as string, n: r.n as number, positives: r.positives as number }));
    },
    async eventLabels(eventId) {
      return (await labelsC.find({ eventId }, { sort: { label: 1 } }).toArray()).map(toLabel);
    },
    async saveFraudModel(m) {
      await modelsC.updateOne({ _id: m.label }, { $set: { model: m } }, { upsert: true });
    },
    async deleteFraudModel(label) {
      await modelsC.deleteMany({ _id: label });
    },
    async fraudModels() {
      return (await modelsC.find({}, { sort: { _id: 1 } }).toArray()).map((d) => d.model as FraudModel);
    },
  };
}
