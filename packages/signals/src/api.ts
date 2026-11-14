import { type SignalId } from './config.js';
import { type SignalResult } from './definitions.js';
import { type ScoreReason } from './scoring.js';
import { type Components, type DeviceAttributes, type SignalPayload } from './types.js';

export type TagValue = string | number | boolean;

export interface IdentifyRequest {
  signals: SignalPayload;
  token?: string;
  tags?: Record<string, TagValue>;
  linkedId?: string;
  sdk: { name: string; version: string };
}

export interface IdentifyResponse {
  eventId: string;
  visitorId: string;
  confidence: number;
  suspectScore: number;
  token: string;
}

export type MatchKind = 'token' | 'similar' | 'new';

export interface EventResponse {
  eventId: string;
  visitorId: string;
  confidence: number;
  matchKind: MatchKind;
  suspectScore: number;
  reasons: ScoreReason[];
  signals: Record<SignalId, SignalResult>;
  components: Components;
  attributes: Pick<
    DeviceAttributes,
    'screenWidth' | 'screenHeight' | 'timezone' | 'languages' | 'platform' | 'userAgent'
  >;
  ip: {
    address: string | null;
    country: string | null;
    asn: number | null;
  };
  tags: Record<string, TagValue> | null;
  linkedId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface VisitorEventSummary {
  eventId: string;
  createdAt: string;
  matchKind: MatchKind;
  confidence: number;
  suspectScore: number;
  linkedId: string | null;
  tags: Record<string, TagValue> | null;
}

export interface VisitorHistoryResponse {
  visitorId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  events: VisitorEventSummary[];
  /** Pass as `cursor` to get the next (older) page; null on the last page. */
  nextCursor: string | null;
}

export const WEBHOOK_TYPES = ['event.created', 'visitor.flagged'] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

/**
 * Body of every webhook POST. `id` is stable across retries of one delivery; dedupe on it
 * (or on `data.eventId` + `type`), since deliveries are at-least-once.
 */
export interface WebhookPayload {
  id: string;
  type: WebhookType;
  createdAt: string;
  data: EventResponse;
}

export interface WebhookEndpointResponse {
  id: string;
  url: string;
  events: WebhookType[];
  flagThreshold: number;
  enabled: boolean;
  createdAt: string;
  /** Returned only when the endpoint is created. */
  secret?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
