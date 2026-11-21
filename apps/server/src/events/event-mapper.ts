import { type BotInfo } from '@trace-id/signals/agents';
import { type FraudScore } from '@trace-id/signals/fraud-score';
import { type IpLocation } from '@trace-id/signals/geo';
import { type EventResponse, type LinkedVisitor, type MatchKind, type TagValue } from '@trace-id/signals/api';
import { type SignalId } from '@trace-id/signals/config';
import { type SignalResult } from '@trace-id/signals/definitions';
import { type ScoreReason } from '@trace-id/signals/scoring';
import { type ListMatch } from '../lists/lists.service.js';
import { type AccountHistory, type AppInfo, type Components, type DeviceAttributes } from '@trace-id/signals/types';

/** Shape of events.signals (jsonb). Raw readings never get here; components are hashes. */
export interface StoredSignals {
  results: Record<SignalId, SignalResult>;
  components: Components;
  attributes: EventResponse['attributes'] & Pick<DeviceAttributes, 'webglRenderer'>;
  sdk: { name: string; version: string };
  /** The framework package that wrapped the SDK, when there was one. */
  via?: { name: string; version: string };
  /** The allow or block list entry this event matched, which set its score. */
  list?: ListMatch;
  collectMs: number;
  /** Absent on events stored before cross-browser linking existed. */
  linkedVisitors?: LinkedVisitor[];
  /** The linkedId's history before this event (fraud score features); absent without a linkedId. */
  account?: AccountHistory;
  /** Absent on events stored before device ids existed; the visitor id stands in. */
  deviceId?: string;
  /** Bot verdict; absent on events stored before it existed. */
  botInfo?: BotInfo;
  /** IP location at the time of the event; absent without a GeoIP City database. */
  ipLocation?: IpLocation;
  /** The browser's plain readings; absent on events stored before they were kept. */
  raw?: DeviceAttributes;
  /** The app and device (React Native SDK); absent for browsers. */
  app?: AppInfo;
  /** Per fraud type, from the project's models at the time; absent before any type was trained. */
  fraudScores?: FraudScore[];
}

export interface EventRow {
  id: string;
  createdAt: Date;
  visitorId: string;
  matchKind: string;
  confidence: number;
  suspectScore: number;
  reasons: unknown;
  signals: unknown;
  ip: string | null;
  asn: number | null;
  country: string | null;
  tags: unknown;
  linkedId: string | null;
}

export function toEventResponse(row: EventRow, verifyWindowMinutes: number): EventResponse {
  const stored = row.signals as StoredSignals;
  return {
    eventId: row.id,
    visitorId: row.visitorId,
    deviceId: stored.deviceId ?? row.visitorId,
    confidence: row.confidence,
    matchKind: row.matchKind as MatchKind,
    suspectScore: row.suspectScore,
    reasons: row.reasons as ScoreReason[],
    signals: stored.results,
    components: stored.components,
    attributes: {
      screenWidth: stored.attributes.screenWidth,
      screenHeight: stored.attributes.screenHeight,
      timezone: stored.attributes.timezone,
      languages: stored.attributes.languages,
      platform: stored.attributes.platform,
      userAgent: stored.attributes.userAgent,
    },
    ip: { address: row.ip, country: row.country, asn: row.asn, ...(stored.ipLocation ? { location: stored.ipLocation } : {}) },
    tags: (row.tags as Record<string, TagValue> | null) ?? null,
    ...(stored.list ? { list: stored.list } : {}),
    ...(stored.sdk ? { client: { sdk: stored.sdk, ...(stored.via ? { via: stored.via } : {}) } } : {}),
    linkedId: row.linkedId,
    linkedVisitors: stored.linkedVisitors ?? [],
    ...(stored.botInfo ? { botInfo: stored.botInfo } : {}),
    ...(stored.raw ? { rawAttributes: stored.raw } : {}),
    ...(stored.app ? { app: stored.app } : {}),
    ...(stored.fraudScores ? { fraudScores: stored.fraudScores } : {}),
    createdAt: row.createdAt.toISOString(),
    expiresAt: new Date(row.createdAt.getTime() + verifyWindowMinutes * 60_000).toISOString(),
  };
}
