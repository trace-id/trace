import { type FraudFeature, type FraudModel } from '@trace-id/signals/fraud-score';
import { type FrequencyTable } from '@trace-id/signals/linkage';
import { type Components } from '@trace-id/signals/types';
import { type StoredEvent } from './event.js';

/**
 * Everything Trace stores, for one app. An adapter implements this against the database the app already runs
 * (MongoDB, Postgres, memory for tests). Records are plain objects with Date fields; adapters map them to rows.
 *
 * Reads are small and bounded (every list takes a limit). The one write, saveIdentification, should be atomic when the
 * database supports it; if it cannot be, the order inside it is chosen so a partial write never breaks matching.
 */
export interface TraceStorage {
  /** One-time setup: indexes, tables. Safe to call on every start. */
  init?(): Promise<void>;

  // Matching
  visitor(id: string): Promise<VisitorRecord | null>;
  visitors(ids: string[]): Promise<VisitorRecord[]>;
  /** Visitor ids that share any of these bucket hashes, at most `limit`. */
  visitorIdsInBuckets(bucketHashes: string[], limit: number): Promise<string[]>;
  /** Visitors whose deviceId is this id, plus the visitor with this id, newest first. */
  visitorsOnDevice(deviceId: string, limit: number): Promise<VisitorRecord[]>;
  /** Optional: value frequencies for the linkage matcher. Without it the matcher uses its priors. */
  frequencies?(components: Components): Promise<FrequencyTable>;

  // Cross-browser linking (device profiles per network)
  networksOfVisitor(visitorId: string, since: Date, limit: number): Promise<string[]>;
  profilesOnNetworks(networks: string[], excludeVisitorId: string, since: Date, limit: number): Promise<DeviceProfileRecord[]>;
  visitorsPerNetwork(networks: string[], since: Date): Promise<Map<string, number>>;
  visitorIdsWithCore(coreHash: string, excludeVisitorId: string, limit: number): Promise<string[]>;
  profilesOfVisitors(visitorIds: string[], limit: number): Promise<DeviceProfileRecord[]>;

  // Accounts (the app's own user id, "linkedId")
  linkedIdsOfVisitors(visitorIds: string[], since: Date, limit: number): Promise<string[]>;
  visitorIdsOfLinkedId(linkedId: string, since: Date, excludeVisitorId: string, limit: number): Promise<string[]>;
  accountsOfVisitors(visitorIds: string[], limit: number): Promise<AccountRecord[]>;

  // The single write per identification
  saveIdentification(write: IdentificationWrite): Promise<void>;

  // Reads for your own backend and admin
  event(id: string): Promise<StoredEvent | null>;
  eventsOfVisitor(visitorId: string, limit: number, before?: Date): Promise<StoredEvent[]>;
  /** Deletes a visitor and everything stored about it (data requests), including its fraud labels. */
  deleteVisitor(visitorId: string): Promise<boolean>;

  // Fraud score. Optional: an adapter without these still identifies; label() then throws and events carry no
  // fraudScores. The bundled adapters implement all of them.
  /** Upsert by (eventId, label). */
  saveLabel?(label: LabelRecord): Promise<void>;
  deleteLabel?(eventId: string, label: string): Promise<boolean>;
  /** Labels of one fraud type, newest updatedAt first, at most `limit`. */
  labels?(label: string, limit: number): Promise<LabelRecord[]>;
  /** Per fraud type: how many labels, and how many say fraud. */
  labelCounts?(): Promise<LabelCount[]>;
  eventLabels?(eventId: string): Promise<LabelRecord[]>;
  /** Upsert by model.label. */
  saveFraudModel?(model: FraudModel): Promise<void>;
  deleteFraudModel?(label: string): Promise<void>;
  fraudModels?(): Promise<FraudModel[]>;
}

/** Your verdict on one event for one fraud type, with the signals that fired, so it outlives the event. */
export interface LabelRecord {
  eventId: string;
  label: string;
  fraud: boolean;
  visitorId: string;
  /** Signals that fired and context features that held (FraudFeature ids). */
  detected: FraudFeature[];
  updatedAt: Date;
}

export interface LabelCount {
  label: string;
  n: number;
  positives: number;
}

export interface VisitorRecord {
  id: string;
  deviceId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  components: Components;
  eventCount: number;
}

export interface DeviceProfileRecord {
  visitorId: string;
  netHash: string;
  coreHash: string | null;
  browser: string;
  profile: unknown;
  lastSeenAt: Date;
}

export interface AccountRecord {
  visitorId: string;
  linkedId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface IdentificationWrite {
  now: Date;
  /** Upsert: create with eventCount 1, or bump lastSeenAt/eventCount and replace components and deviceId. */
  visitor: { id: string; deviceId: string; components: Components };
  /** Insert, ignoring duplicates. */
  buckets: string[];
  /** Upsert by (visitorId, netHash). */
  profile: Omit<DeviceProfileRecord, 'lastSeenAt'> | null;
  /** Upsert by (visitorId, linkedId). */
  account: { visitorId: string; linkedId: string } | null;
  event: StoredEvent;
}
