import { type IpLocation } from './geo.js';
import { type BotInfo } from './agents.js';
import { type FraudModel, type FraudScore } from './fraud-score.js';
import { type SignalId } from './config.js';
import { type SignalResult } from './definitions.js';
import { type ScoreReason } from './scoring.js';
import { type AppInfo, type Components, type DeviceAttributes, type SignalPayload } from './types.js';

export type TagValue = string | number | boolean;

export interface IdentifyRequest {
  signals: SignalPayload;
  token?: string;
  tags?: Record<string, TagValue>;
  linkedId?: string;
  sdk: { name: string; version: string };
  /** Device clock (ms since epoch) when the request was sent; the server derives the clock offset, shared by every browser on the device. */
  sentAt?: number;
  /** Random per call (32 hex characters); lets the server spot a request sent twice. */
  nonce?: string;
}

export interface IdentifyResponse {
  eventId: string;
  visitorId: string;
  /** Shared by every browser on one device (see linkedVisitors): the first-seen browser's id. Equals visitorId until a link is made. */
  deviceId: string;
  confidence: number;
  suspectScore: number;
  token: string;
  /**
   * The full event (as GET /v1/events returns it), AES-256-GCM encrypted with the server's SEALED_RESULTS_KEY. Only
   * present when that key is set. Pass it to your backend and open it with unsealEventResult from @trace-id/sdk-node.
   */
  sealedResult?: string;
}

export type MatchKind = 'token' | 'similar' | 'new';

/** Another visitor that looks like this device in a different browser or browser profile. */
export interface LinkedVisitor {
  visitorId: string;
  /** 0-1: share of device traits that match, reduced when the network is not shared. */
  confidence: number;
  /** Browser family that visitor last used (chrome, edge, firefox, safari, ...). */
  browser: string;
  /** Seen on a network this visitor also used (now or within the window). */
  sameNetwork: boolean;
  /** How many distinct networks the two share. */
  sharedNetworks: number;
  /** sharedNetwork: matched on a common network; rareHardware: different networks, but hardware rare in this project. */
  via: 'sharedNetwork' | 'rareHardware';
  lastSeenAt: string;
}

export interface EventResponse {
  eventId: string;
  visitorId: string;
  /** Shared by every browser on one device (see linkedVisitors): the first-seen browser's id. Equals visitorId until a link is made. */
  deviceId: string;
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
    /** City-level location and proximity zone, when the operator configured a GeoIP City database. */
    location?: IpLocation;
  };
  tags: Record<string, TagValue> | null;
  linkedId: string | null;
  /** Empty when cross-browser linking is off or nothing matched. */
  linkedVisitors: LinkedVisitor[];
  /**
   * Bot verdict: good (a declared crawler or a signed AI agent), bad (automation or an unsigned agent) or notDetected,
   * with the bot's type, name and whether its identity was proven by a signature. Absent on events stored before it existed.
   */
  botInfo?: BotInfo;
  /**
   * The browser's plain readings: screen, hardware, locale, platform, client hints and GPU. Low-entropy values only;
   * high-entropy readings (canvas, audio, fonts) stay hashed in components. Absent on events stored before it existed.
   */
  rawAttributes?: DeviceAttributes;
  /** The app and device, for events from the React Native SDK; absent for browsers. */
  app?: AppInfo;
  /**
   * Probability per fraud type, from models trained on the project's own labels, with the signals that raised it.
   * Absent until a type has enough labels, and on events stored before it existed.
   */
  fraudScores?: FraudScore[];
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
  /** Shared by every browser on one device (see linkedVisitors): the first-seen browser's id. Equals visitorId until a link is made. */
  deviceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  events: VisitorEventSummary[];
  /** Pass as `cursor` to get the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** GET /v1/devices/:deviceId: every browser (visitor) of one device and the accounts seen on it. */
export interface DeviceResponse {
  deviceId: string;
  visitors: {
    visitorId: string;
    /** Browser family last seen, or null before cross-browser profiles were recorded. */
    browser: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    eventCount: number;
  }[];
  accounts: {
    linkedId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    visitorIds: string[];
  }[];
}

export const WEBHOOK_TYPES =['event.created', 'visitor.flagged'] as const;
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

// Management API (dashboard session auth).

export type ProjectRoleName = 'owner' | 'admin' | 'viewer';

export interface ProjectResponse {
  id: string;
  name: string;
  retentionDays: number;
  role: ProjectRoleName;
  createdAt: string;
}

export interface MeResponse {
  user: { id: string; email: string; name: string };
  projects: ProjectResponse[];
}

export interface ApiKeyResponse {
  id: string;
  type: 'public' | 'secret';
  name: string | null;
  prefix: string;
  allowedOrigins: string[];
  createdAt: string;
  revokedAt: string | null;
  /** Full key, returned only when created. */
  key?: string;
}

export interface UsageDay {
  day: string;
  events: number;
  newVisitors: number;
  suspicious: number;
}

export interface UsageResponse {
  days: UsageDay[];
  suspiciousThreshold: number;
}

export interface EventSearchItem extends VisitorEventSummary {
  visitorId: string;
  /** Added with the analytics dashboard; absent from older servers. */
  ip?: string | null;
  country?: string | null;
  /** Signal ids that fired on this event. */
  detected?: string[];
  browser?: string | null;
  os?: string | null;
  /** Desktop, Mobile, Tablet or Bot, from the user agent. */
  deviceType?: string | null;
}

export interface CountRow {
  key: string;
  events: number;
  visitors: number;
  suspicious: number;
}

export interface AnalyticsTotals {
  events: number;
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  suspicious: number;
  /** Events with a bot, VPN, Tor, proxy, tampering or anti-detect signal. */
  automated: number;
  avgScore: number;
  avgConfidence: number;
  uniqueIps: number;
  uniqueLinkedIds: number;
}

export interface AnalyticsPoint {
  /** ISO day (YYYY-MM-DD) or ISO hour (YYYY-MM-DDTHH) when the window is 2 days or less. */
  t: string;
  events: number;
  visitors: number;
  newVisitors: number;
  suspicious: number;
}

/** GET /v1/projects/:id/analytics?days=N */
export interface AnalyticsResponse {
  days: number;
  from: string;
  to: string;
  suspiciousThreshold: number;
  totals: AnalyticsTotals;
  /** The same totals for the window before this one, for change indicators. */
  previous: AnalyticsTotals;
  series: AnalyticsPoint[];
  /** Ten buckets: 0-9, 10-19 ... 90-100. */
  scoreHistogram: number[];
  matchKinds: Record<string, number>;
  signals: { id: string; events: number; visitors: number }[];
  countries: CountRow[];
  asns: CountRow[];
  browsers: CountRow[];
  os: CountRow[];
  deviceTypes: CountRow[];
  topIps: CountRow[];
  topLinkedIds: CountRow[];
  /** Events per weekday (0=Sunday) and hour of day (UTC): 7 rows of 24. */
  heatmap: number[][];
  sdks: { key: string; events: number }[];
}

export interface VisitorListItem {
  visitorId: string;
  deviceId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  maxScore: number;
  lastScore: number;
  lastCountry: string | null;
  lastIp: string | null;
  browser: string | null;
  os: string | null;
  deviceType?: string | null;
  linkedIds: number;
}

export interface VisitorListResponse {
  visitors: VisitorListItem[];
  nextCursor: string | null;
}

export interface LinkedIdListItem {
  linkedId: string;
  events: number;
  visitors: number;
  devices: number;
  maxScore: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LinkedIdListResponse {
  accounts: LinkedIdListItem[];
  nextCursor: string | null;
}

export interface EventSearchResponse {
  events: EventSearchItem[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface EventLabelRequest {
  fraud: boolean;
}

export interface EventLabelResponse {
  eventId: string;
  label: string;
  fraud: boolean;
}

export interface EventLabelsResponse {
  labels: { label: string; fraud: boolean; updatedAt: string }[];
}

export type FraudModelSummary = Omit<FraudModel, 'version'>;

export interface FraudModelsResponse {
  models: FraudModelSummary[];
  /** Fraud types with labels but not enough to train, with their counts. */
  untrained: { label: string; n: number; positives: number }[];
}

export interface RingSummary {
  id: string;
  /** Devices in the ring. */
  size: number;
  accounts: number;
  ips: number;
  events: number;
  maxScore: number;
  avgPeakScore: number;
  /** 0-100: larger rings with higher scores and more shared infrastructure rank higher. */
  risk: number;
  sharedIps: string[];
  sharedAccounts: string[];
  sampleVisitors: string[];
  lastSeenAt: string;
}

export interface RingsResponse {
  days: number;
  /** The window held more distinct visitor-IP-account combinations than were read. */
  truncated: boolean;
  rings: RingSummary[];
}

export interface GraphNode {
  id: string;
  type: 'visitor' | 'account' | 'ip';
  label: string;
  score: number;
  events: number;
}

export interface GraphResponse {
  seed: string;
  truncated: boolean;
  nodes: GraphNode[];
  edges: { source: string; target: string; weight: number }[];
}

export interface PolicySimulation {
  days: number;
  totalEvents: number;
  totalVisitors: number;
  matchedEvents: number;
  matchedVisitors: number;
  matchedAccounts: number;
  matchRate: number;
  series: { t: string; matched: number }[];
  scoreBands: number[];
  topAccounts: { linkedId: string; hits: number }[];
}

export interface QualityResponse {
  days: number;
  events: number;
  collectMs: { p50: number | null; p95: number | null; p99: number | null };
  coverage: { linkedId: number; tags: number; ip: number; country: number };
  identification: { new: number; token: number; match: number; conflict: number };
  components: { name: string; share: number }[];
  confidenceBuckets: number[];
}
