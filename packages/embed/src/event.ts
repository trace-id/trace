import { type BotInfo } from '@trace-id/signals/agents';
import { type FraudScore } from '@trace-id/signals/fraud-score';
import { type IpLocation } from '@trace-id/signals/geo';
import { type EventResponse, type LinkedVisitor, type MatchKind, type TagValue } from '@trace-id/signals/api';
import { type SignalId } from '@trace-id/signals/config';
import { type SignalResult } from '@trace-id/signals/definitions';
import { type ScoreReason } from '@trace-id/signals/scoring';
import { type AccountHistory, type AppInfo, type Components, type DeviceAttributes } from '@trace-id/signals/types';

/** The signal part of a stored event. Raw readings never get here; components are hashes. */
export interface StoredSignals {
  results: Record<SignalId, SignalResult>;
  components: Components;
  attributes: EventResponse['attributes'] & Pick<DeviceAttributes, 'webglRenderer'>;
  sdk: { name: string; version: string };
  collectMs: number;
  linkedVisitors?: LinkedVisitor[];
  /** The linkedId's history before this event (fraud score features); absent without a linkedId. */
  account?: AccountHistory;
  deviceId?: string;
  /** Bot verdict; absent on events stored before it existed. */
  botInfo?: BotInfo;
  /** IP location at the time of the event; absent without City-level IP data. */
  ipLocation?: IpLocation;
  /** The browser's plain readings; absent on events stored before they were kept. */
  raw?: DeviceAttributes;
  /** The app and device (React Native SDK); absent for browsers. */
  app?: AppInfo;
  /** Per trained fraud type, at the time of the event. */
  fraudScores?: FraudScore[];
}

/** One identification as stored. Adapters keep it as one document or row. */
export interface StoredEvent {
  id: string;
  createdAt: Date;
  visitorId: string;
  matchKind: MatchKind;
  confidence: number;
  suspectScore: number;
  reasons: ScoreReason[];
  signals: StoredSignals;
  ip: string | null;
  asn: number | null;
  country: string | null;
  tags: Record<string, TagValue> | null;
  linkedId: string | null;
}

/** The verified event, as GET /v1/events/:id returns it from the standalone server. */
export function toEventResponse(e: StoredEvent, verifyWindowMinutes: number): EventResponse {
  const s = e.signals;
  return {
    eventId: e.id,
    visitorId: e.visitorId,
    deviceId: s.deviceId ?? e.visitorId,
    confidence: e.confidence,
    matchKind: e.matchKind,
    suspectScore: e.suspectScore,
    reasons: e.reasons,
    signals: s.results,
    components: s.components,
    attributes: {
      screenWidth: s.attributes.screenWidth,
      screenHeight: s.attributes.screenHeight,
      timezone: s.attributes.timezone,
      languages: s.attributes.languages,
      platform: s.attributes.platform,
      userAgent: s.attributes.userAgent,
    },
    ip: { address: e.ip, country: e.country, asn: e.asn, ...(s.ipLocation ? { location: s.ipLocation } : {}) },
    tags: e.tags,
    linkedId: e.linkedId,
    linkedVisitors: s.linkedVisitors ?? [],
    ...(s.botInfo ? { botInfo: s.botInfo } : {}),
    ...(s.raw ? { rawAttributes: s.raw } : {}),
    ...(s.app ? { app: s.app } : {}),
    ...(s.fraudScores ? { fraudScores: s.fraudScores } : {}),
    createdAt: e.createdAt.toISOString(),
    expiresAt: new Date(e.createdAt.getTime() + verifyWindowMinutes * 60_000).toISOString(),
  };
}
