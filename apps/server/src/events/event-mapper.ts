import { type EventResponse, type MatchKind, type TagValue } from '@tbdname/signals/api';
import { type SignalId } from '@tbdname/signals/config';
import { type SignalResult } from '@tbdname/signals/definitions';
import { type ScoreReason } from '@tbdname/signals/scoring';
import { type Components, type DeviceAttributes } from '@tbdname/signals/types';

/** Shape of events.signals (jsonb). Raw readings never get here; components are hashes. */
export interface StoredSignals {
  results: Record<SignalId, SignalResult>;
  components: Components;
  attributes: EventResponse['attributes'] & Pick<DeviceAttributes, 'webglRenderer'>;
  sdk: { name: string; version: string };
  collectMs: number;
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
    ip: { address: row.ip, country: row.country, asn: row.asn },
    tags: (row.tags as Record<string, TagValue> | null) ?? null,
    linkedId: row.linkedId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: new Date(row.createdAt.getTime() + verifyWindowMinutes * 60_000).toISOString(),
  };
}
