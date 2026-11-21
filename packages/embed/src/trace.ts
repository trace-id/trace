import {
  type DeviceResponse,
  type EventLabelResponse,
  type EventLabelsResponse,
  type EventResponse,
  type FraudModelsResponse,
  type IdentifyResponse,
} from '@trace-id/signals/api';
import { DEFAULT_FLAGGED_NETWORK_CONFIG, type ScoringConfig } from '@trace-id/signals/config';
import {
  FRAUD_LABEL_PATTERN,
  FRAUD_MODEL_MINIMUM,
  type FraudModel,
  type FeatureSource,
  fraudFeatures,
  knownFeatures,
  scoreFraud,
  trainFraudModel,
} from '@trace-id/signals/fraud-score';
import { readDeviceProfile } from '@trace-id/signals/crossbrowser';
import { botInfo, evaluateSignals } from '@trace-id/signals/definitions';
import { type AgentVerifierOptions, createAgentVerifier } from '@trace-id/sdk-node/agents';
import { type CrawlerVerifierOptions, createCrawlerVerifier } from '@trace-id/sdk-node/crawlers';
import { matchKnownAgent } from '@trace-id/signals/agents';
import { deviceRarity } from '@trace-id/signals/rarity';
import { computeSuspectScore } from '@trace-id/signals/scoring';
import { type IpInfo, type RequestHeaders } from '@trace-id/signals/types';
import { DEFAULT_SCORING, parseScoringConfig } from './config.js';
import { clearedVisitorCookie, readVisitorCookie, visitorCookie } from './cookie.js';
import { memoryCounters, type TraceCounters } from './counters.js';
import { bucketHashes, type CandidateSource, matchVisitor } from './engine.js';
import { type StoredEvent, type StoredSignals, toEventResponse } from './event.js';
import { newVisitorId, UUID_V7, uuidv7 } from './ids.js';
import { ipKey, type IpStorageMode, networkKey, storableIp } from './ip.js';
import { accountHistory, deviceView, networkReputation, findLinks, resolveDeviceId, summarizeAccounts, summarizeLinks } from './linking.js';
import { parseIdentifyRequest } from './schema.js';
import { sealResult } from './seal.js';
import { type TraceStorage } from './storage.js';

/** Fraud types per app, and the newest labels per type used for training (same limits as the server). */
const MAX_FRAUD_LABELS = 20;
const MAX_TRAINING_LABELS = 50_000;
const MODEL_CACHE_MS = 60_000;
/** How long request nonces are remembered for replay detection. */
const NONCE_TTL_MS = 24 * 3_600_000;

import { issueToken, verifyToken } from './token.js';

export interface TraceOptions {
  /** Where Trace keeps its data: mongoStorage(db), postgresStorage(pool), memoryStorage() for tests. */
  storage: TraceStorage;
  /** At least 32 random characters. Signs visitor tokens and keys IP hashes. Keep it stable and secret. */
  secret: string;
  /** Velocity counters. Default: in-process. With several app instances, pass redisCounters(yourRedis). */
  counters?: TraceCounters | false;
  /** Scoring weights and thresholds. Default: the bundled scoring.default.json. Partial objects are validated. */
  scoring?: ScoringConfig | unknown;
  /**
   * IP reputation and location (Tor, datacenter, VPN, proxy, country). Pass `createIpIntel({ sources })` from
   * `@trace-id/ip-intel` to use IP data providers and lists; a plain object with a sync or async `lookup` works too.
   * Default: none, so those signals report "not available".
   */
  ipIntel?: { lookup(ip: string, header?: (name: string) => string | null): IpInfo | Promise<IpInfo> };
  /**
   * Verify Web Bot Auth signatures (signed AI agents such as ChatGPT agent) on identify requests. Default on, trusting
   * https://chatgpt.com; pass options to trust more agent key directories, or false to turn it off.
   */
  agents?: AgentVerifierOptions | false;
  /**
   * Confirm claimed crawlers and AI agents: against their operators' published IP ranges when you pass `ranges` (see
   * fetchCrawlerRanges in @trace-id/sdk-node/crawlers), else by reverse DNS for search engines. Default on; false turns
   * it off (no DNS lookups).
   */
  crawlers?: CrawlerVerifierOptions | false;
  /** What to keep of the IP on each event. Default 'truncated' (the last octet zeroed). */
  ipStorage?: IpStorageMode;
  /** Link browsers on the same device. Default true; always off when ipStorage is 'none'. */
  crossBrowser?: boolean;
  /** First-party visitor cookie, set on the identify response. Default on, named _trace_vt. */
  cookie?: false | { name?: string; domain?: string; path?: string; secure?: boolean };
  /** If set, identify requests must carry this key (?apiKey=). Leave unset when the route is your own. */
  publicKey?: string;
  /** How long an event can be verified after it happened. Default 60 minutes. */
  verifyWindowMinutes?: number;
  /** Base64 of 32 bytes: adds an encrypted copy of the full event to the browser response (sealed results). */
  sealKey?: string;
  /** Called after every identification with the full event: your webhook, queue or log, in-process. */
  onEvent?: (event: EventResponse) => void | Promise<void>;
  /**
   * Fraud score from your labels (needs a storage adapter with label support; the bundled ones have it). Models retrain
   * `retrainAfterMs` after the last label change (default 30 s) and on trainFraudModels(). false turns scoring off.
   */
  fraudScore?: false | { retrainAfterMs?: number };
  /** Default: silent. Pass console.log, or your logger. */
  log?: (message: string) => void;
}

export interface IdentifyContext {
  /** The client IP, as your framework resolved it (behind a proxy, from X-Forwarded-For you trust). */
  ip: string;
  /** Request headers; only user agent, client hints and Accept-Language are read. */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The query's apiKey, when publicKey is set. */
  apiKey?: string | null;
  /** Path the identify route is served at, for the cookie (adapters fill this in). Default /v1/identify. */
  cookiePath?: string;
  /** Absolute request URL and method, for checking signed AI agents. Adapters fill these in; without them that check is skipped. */
  url?: string;
  method?: string;
}

export interface IdentifyOutcome {
  result: IdentifyResponse;
  /** A Set-Cookie value to send back, when the cookie is on. */
  setCookie: string | null;
}

export class TraceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TraceError';
  }
}

export interface Trace {
  /** Handles one identify request body. Framework adapters call this; you rarely need to. */
  identify(body: unknown, ctx: IdentifyContext): Promise<IdentifyOutcome>;
  /** The verified event for an eventId your frontend sent. Throws TraceError (404, 410) if unknown or too old. */
  verify(eventId: string): Promise<EventResponse>;
  /** The event without the verification window, or null. For your admin and investigations. */
  event(eventId: string): Promise<EventResponse | null>;
  /** A visitor's recent events, newest first. */
  visitorEvents(visitorId: string, opts?: { limit?: number; before?: Date }): Promise<EventResponse[]>;
  /** Every browser and account seen on a device, or null. */
  device(deviceId: string): Promise<DeviceResponse | null>;
  /** Deletes a visitor and its data (data requests). */
  deleteVisitor(visitorId: string): Promise<boolean>;
  /**
   * Records your verdict on an event for one fraud type ("payment", "account_takeover"...). Trace trains one model per
   * type from these labels and adds fraudScores to new events. Throws TraceError 400 (bad id or label), 404 (unknown
   * event), 409 (more than 20 types) or 501 (storage without label support).
   */
  label(eventId: string, label: string, fraud: boolean): Promise<EventLabelResponse>;
  /** Removes a label; false when there was none. */
  unlabel(eventId: string, label: string): Promise<boolean>;
  /** The labels on one event. */
  eventLabels(eventId: string): Promise<EventLabelsResponse>;
  /** Trained models, and fraud types still short of labels. */
  fraudModels(): Promise<FraudModelsResponse>;
  /** Retrains every fraud type now. */
  trainFraudModels(): Promise<FraudModelsResponse>;
  /** The Set-Cookie value that clears the visitor cookie (the SDK's "forget" call). */
  forgetCookie(cookiePath?: string): string | null;
  readonly scoring: ScoringConfig;
}

const DEVICE_ID = /^[0-9A-Za-z]{20}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const NO_IP_INTEL: IpInfo = { tor: false, datacenter: false, blocklisted: false, country: null, asn: null, asnOrg: null };

function readHeaders(h: IdentifyContext['headers']): { get(name: string): string | null } {
  if (typeof (h as Headers).get === 'function') return { get: (n) => (h as Headers).get(n) };
  const rec = h as Record<string, string | string[] | undefined>;
  return {
    get: (n) => {
      const v = rec[n] ?? rec[n.toLowerCase()];
      return Array.isArray(v) ? v.join(', ') : (v ?? null);
    },
  };
}

/**
 * Trace inside your own backend: no separate server. Give it a storage adapter for the database you already run, mount
 * one route for the browser SDK, and call verify() where you make decisions.
 */
export function createTrace(options: TraceOptions): Trace {
  if (typeof options.secret !== 'string' || options.secret.length < 32) {
    throw new Error('createTrace: secret must be at least 32 characters');
  }
  const storage = options.storage;
  const secret = options.secret;
  const scoring: ScoringConfig = options.scoring === undefined ? DEFAULT_SCORING : parseScoringConfig(options.scoring);
  const counters = options.counters === false ? null : (options.counters ?? memoryCounters());
  const ipStorage = options.ipStorage ?? 'truncated';
  const linking = options.crossBrowser !== false && ipStorage !== 'none';
  const verifyWindow = options.verifyWindowMinutes ?? 60;
  const sealKey = options.sealKey ? Buffer.from(options.sealKey, 'base64') : null;
  if (sealKey && sealKey.length !== 32) throw new Error('createTrace: sealKey must be base64 of exactly 32 bytes');
  const cookie = options.cookie === false ? null : { name: options.cookie?.name ?? '_trace_vt', domain: options.cookie?.domain, path: options.cookie?.path, secure: options.cookie?.secure ?? true };
  const log = options.log ?? (() => {});
  const verifyAgent = options.agents === false ? null : createAgentVerifier(options.agents ?? {});
  const verifyCrawler = options.crawlers === false ? null : createCrawlerVerifier(options.crawlers ?? {});
  // Single-app mode: one namespace. Tokens still bind to it, so tokens from another Trace install never verify here.
  const project = 'embed';
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= Promise.resolve(storage.init?.()));

  // Fraud score: on when the adapter supports labels and the option is not false.
  const fraudOn =
    options.fraudScore !== false &&
    !!(storage.saveLabel && storage.deleteLabel && storage.labels && storage.labelCounts && storage.eventLabels && storage.saveFraudModel && storage.deleteFraudModel && storage.fraudModels);
  const retrainAfterMs = (options.fraudScore === false ? undefined : options.fraudScore?.retrainAfterMs) ?? 30_000;
  let modelCache: { at: number; models: FraudModel[] } | null = null;
  let retrainTimer: ReturnType<typeof setTimeout> | null = null;
  const requireFraud = () => {
    if (!fraudOn) throw new TraceError(501, 'not_supported', 'Fraud score is off, or the storage adapter does not support labels');
  };
  async function currentModels(): Promise<FraudModel[]> {
    if (!fraudOn) return [];
    if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.models;
    const models = await storage.fraudModels!();
    modelCache = { at: Date.now(), models };
    // After a restart a pending retrain is lost: retrain when the labels no longer match what the models saw.
    const counts = await storage.labelCounts!();
    const byLabel = new Map(models.map((m) => [m.label, m]));
    const stale =
      models.some((m) => !counts.some((c) => c.label === m.label)) ||
      counts.some((c) => {
        const m = byLabel.get(c.label);
        const n = Math.min(c.n, MAX_TRAINING_LABELS);
        return m ? m.n !== n : n >= FRAUD_MODEL_MINIMUM.examples;
      });
    if (stale) scheduleRetrain(0);
    return models;
  }
  function scheduleRetrain(delay = retrainAfterMs): void {
    if (retrainTimer) clearTimeout(retrainTimer);
    retrainTimer = setTimeout(() => {
      retrainTimer = null;
      trainAll().catch((err: unknown) => log(`trace: fraud model training failed: ${err instanceof Error ? err.message : String(err)}`));
    }, delay);
    (retrainTimer as { unref?: () => void }).unref?.();
  }
  async function listModels(): Promise<FraudModelsResponse> {
    const [models, counts] = await Promise.all([storage.fraudModels!(), storage.labelCounts!()]);
    const trained = new Set(models.map((m) => m.label));
    return {
      models: models
        .map(({ version: _v, ...m }) => m)
        .sort((a, b) => a.label.localeCompare(b.label)),
      untrained: counts
        .filter((c) => !trained.has(c.label))
        .map((c) => ({ label: c.label, n: c.n, positives: c.positives }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }
  async function trainAll(): Promise<FraudModelsResponse> {
    const now = new Date();
    const counts = await storage.labelCounts!();
    for (const { label } of counts) {
      const rows = await storage.labels!(label, MAX_TRAINING_LABELS);
      const model = trainFraudModel(
        label,
        rows.map((r) => ({ fraud: r.fraud, detected: knownFeatures(r.detected) })),
        { now },
      );
      if (model) await storage.saveFraudModel!(model);
      else await storage.deleteFraudModel!(label);
    }
    for (const m of await storage.fraudModels!()) if (!counts.some((c) => c.label === m.label)) await storage.deleteFraudModel!(m.label);
    modelCache = null;
    return listModels();
  }
  function checkLabelArgs(eventId: string, label: string): void {
    if (!UUID_V7.test(eventId)) throw new TraceError(400, 'invalid_event_id', 'eventId is not a valid event id');
    if (!FRAUD_LABEL_PATTERN.test(label)) throw new TraceError(400, 'invalid_label', 'label must match ^[a-z][a-z0-9_]{0,31}$');
  }

  const candidates: CandidateSource = {
    async byId(id) {
      const v = await storage.visitor(id);
      return v ? { id: v.id, components: v.components, lastSeenAt: v.lastSeenAt } : null;
    },
    async byBuckets(hashes, limit) {
      const ids = await storage.visitorIdsInBuckets(hashes, limit);
      if (ids.length === 0) return [];
      return (await storage.visitors(ids)).map((v) => ({ id: v.id, components: v.components, lastSeenAt: v.lastSeenAt }));
    },
    ...(storage.frequencies ? { frequencies: (c) => storage.frequencies!(c) } : {}),
  };

  async function identify(body: unknown, ctx: IdentifyContext): Promise<IdentifyOutcome> {
    await init();
    if (options.publicKey && ctx.apiKey !== options.publicKey) throw new TraceError(401, 'invalid_api_key', 'Unknown public key');
    const parsed = parseIdentifyRequest(typeof body === 'string' ? safeJson(body) : body);
    if (!parsed.ok) throw new TraceError(400, 'bad_request', parsed.message);
    const req = parsed.value;
    const started = performance.now();
    const receivedAt = Date.now();
    const headers = readHeaders(ctx.headers);
    const cap = (v: string | null) => (v === null ? null : v.slice(0, 512));
    const requestHeaders: RequestHeaders = {
      userAgent: cap(headers.get('user-agent')),
      secChUa: cap(headers.get('sec-ch-ua')),
      secChUaPlatform: cap(headers.get('sec-ch-ua-platform')),
      acceptLanguage: cap(headers.get('accept-language')),
    };
    const cookieToken = cookie ? readVisitorCookie(headers.get('cookie') ?? undefined, cookie.name) : null;

    const components = req.signals.components;
    const decision = await matchVisitor(
      {
        components,
        tokenVisitorId: verifyToken(secret, project, req.token) ?? verifyToken(secret, project, cookieToken ?? undefined),
      },
      candidates,
      scoring.identification,
    );
    const visitorId = decision.visitorId ?? newVisitorId();
    const hashedIp = ipKey(ctx.ip, secret);
    const ip = (await options.ipIntel?.lookup(ctx.ip, (name) => headers.get(name))) ?? NO_IP_INTEL;
    const velocity = counters ? await counters.record({ visitorId, ipKey: hashedIp, linkedId: req.linkedId ?? null, country: ip.country }) : null;
    const now = new Date();
    const device = readDeviceProfile(req.signals, { clockOffsetMs: req.sentAt === undefined ? null : req.sentAt - receivedAt });
    const netHash = linking ? networkKey(ctx.ip, secret) : null;
    const linkedVisitors = netHash ? await findLinks(storage, visitorId, device, netHash, now, scoring.crossBrowser) : [];
    const deviceId = await resolveDeviceId(storage, visitorId, linkedVisitors, scoring.crossBrowser.signalThreshold);
    const linkedId = req.linkedId ?? null;
    const [accounts, history] = await Promise.all([
      summarizeAccounts(storage, visitorId, deviceId, linkedId, now, scoring.accounts.windowHours),
      accountHistory(storage, visitorId, deviceId, linkedId),
    ]);
    const signedAgent = verifyAgent && ctx.url ? await verifyAgent({ method: ctx.method ?? 'POST', url: ctx.url, headers: ctx.headers }) : null;
    // Rarity needs component statistics, which only some storage adapters keep (frequencies()).
    const rarity = storage.frequencies && scoring.suspect.weights.rareDevice > 0 ? deviceRarity(components, await storage.frequencies(components)) : null;
    const claimed = matchKnownAgent(requestHeaders.userAgent ?? req.signals.attributes.userAgent);
    const crawlerVerified = verifyCrawler && claimed ? await verifyCrawler(ctx.ip, claimed.name) : null;
    const nonceFresh = req.nonce && counters?.claimNonce ? await counters.claimNonce(req.nonce, NONCE_TTL_MS) : null;
    const replay = nonceFresh === null || nonceFresh === undefined ? null : { nonceSeen: !nonceFresh, sentAgoMs: req.sentAt === undefined ? null : receivedAt - req.sentAt };
    const network =
      netHash && scoring.suspect.weights.flaggedNetwork > 0
        ? await networkReputation(storage, visitorId, netHash, now, scoring.flaggedNetwork ?? DEFAULT_FLAGGED_NETWORK_CONFIG)
        : null;
    const evalCtx = { network, replay, rarity, crawlerVerified, payload: req.signals, headers: requestHeaders, ip, velocity, crossBrowser: netHash ? summarizeLinks(linkedVisitors) : null, accounts, tls: null, now, signedAgent };
    const results = evaluateSignals(evalCtx, scoring);
    const score = computeSuspectScore(results, scoring);
    const models = await currentModels();
    const features = models.length ? fraudFeatures({ matchKind: decision.kind, confidence: round2(decision.confidence), createdAt: now, results, linkedVisitors, timezone: req.signals.attributes.timezone, account: history }) : [];
    const fraudScores = models.map((m) => scoreFraud(m, features));

    const a = req.signals.attributes;
    const signals: StoredSignals = {
      results,
      components,
      attributes: { screenWidth: a.screenWidth, screenHeight: a.screenHeight, timezone: a.timezone, languages: a.languages, platform: a.platform, userAgent: a.userAgent, webglRenderer: a.webglRenderer },
      sdk: req.sdk,
      ...(req.via ? { via: req.via } : {}),
      collectMs: req.signals.collectMs,
      linkedVisitors,
      deviceId,
      botInfo: botInfo(evalCtx, results.bot.detected),
      ...(ip.location ? { ipLocation: ip.location } : {}),
      raw: req.signals.attributes,
      ...(req.signals.app ? { app: req.signals.app } : {}),
      ...(history ? { account: history } : {}),
      ...(fraudScores.length ? { fraudScores } : {}),
    };
    const confidence = round2(decision.confidence);
    const event: StoredEvent = {
      id: uuidv7(now),
      createdAt: now,
      visitorId,
      matchKind: decision.kind,
      confidence,
      suspectScore: score.score,
      reasons: score.reasons,
      signals,
      ip: storableIp(ctx.ip, ipStorage, secret),
      asn: ip.asn,
      country: ip.country,
      tags: req.tags ?? null,
      linkedId,
    };

    await storage.saveIdentification({
      now,
      visitor: { id: visitorId, deviceId, components },
      buckets: bucketHashes(components, scoring.identification.buckets),
      profile: netHash ? { visitorId, netHash, coreHash: device.coreHash, browser: device.browser, profile: device.profile } : null,
      account: linkedId ? { visitorId, linkedId } : null,
      event,
    });

    const response = toEventResponse(event, verifyWindow);
    if (options.onEvent) {
      Promise.resolve()
        .then(() => options.onEvent!(response))
        .catch((err: unknown) => log(`trace: onEvent failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    log(`trace: event=${event.id} visitor=${visitorId} match=${decision.kind} device=${deviceId} score=${score.score} ms=${Math.round(performance.now() - started)}`);

    const token = issueToken(secret, project, visitorId, now);
    return {
      result: {
        eventId: event.id,
        visitorId,
        deviceId,
        confidence,
        suspectScore: score.score,
        token,
        ...(sealKey ? { sealedResult: sealResult(response, sealKey) } : {}),
      },
      setCookie: cookie ? visitorCookie(token, { ...cookie, path: cookie.path ?? ctx.cookiePath }) : null,
    };
  }

  return {
    scoring,
    identify,
    async verify(eventId) {
      await init();
      if (!UUID_V7.test(eventId)) throw new TraceError(400, 'invalid_event_id', 'eventId is not a valid event id');
      const e = await storage.event(eventId);
      if (!e) throw new TraceError(404, 'not_found', 'Event not found');
      if (Date.now() - e.createdAt.getTime() > verifyWindow * 60_000) throw new TraceError(410, 'event_expired', 'Event is older than the verification window');
      return toEventResponse(e, verifyWindow);
    },
    async event(eventId) {
      await init();
      if (!UUID_V7.test(eventId)) return null;
      const e = await storage.event(eventId);
      return e ? toEventResponse(e, verifyWindow) : null;
    },
    async visitorEvents(visitorId, opts = {}) {
      await init();
      const rows = await storage.eventsOfVisitor(visitorId, Math.min(Math.max(opts.limit ?? 20, 1), 100), opts.before);
      return rows.map((e) => toEventResponse(e, verifyWindow));
    },
    async device(deviceId) {
      await init();
      if (!DEVICE_ID.test(deviceId)) return null;
      return deviceView(storage, deviceId);
    },
    async deleteVisitor(visitorId) {
      await init();
      return storage.deleteVisitor(visitorId);
    },
    async label(eventId, label, fraud) {
      await init();
      requireFraud();
      checkLabelArgs(eventId, label);
      if (typeof fraud !== 'boolean') throw new TraceError(400, 'bad_request', 'fraud must be a boolean');
      const e = await storage.event(eventId);
      if (!e) throw new TraceError(404, 'not_found', 'Event not found');
      const counts = await storage.labelCounts!();
      if (!counts.some((c) => c.label === label) && counts.length >= MAX_FRAUD_LABELS) {
        throw new TraceError(409, 'limit_reached', `At most ${MAX_FRAUD_LABELS} fraud types`);
      }
      await storage.saveLabel!({ eventId, label, fraud, visitorId: e.visitorId, detected: fraudFeatures(featureSource(e)), updatedAt: new Date() });
      scheduleRetrain();
      return { eventId, label, fraud };
    },
    async unlabel(eventId, label) {
      await init();
      requireFraud();
      checkLabelArgs(eventId, label);
      const removed = await storage.deleteLabel!(eventId, label);
      if (removed) scheduleRetrain();
      return removed;
    },
    async eventLabels(eventId) {
      await init();
      requireFraud();
      if (!UUID_V7.test(eventId)) return { labels: [] };
      const rows = await storage.eventLabels!(eventId);
      return { labels: rows.map((l) => ({ label: l.label, fraud: l.fraud, updatedAt: l.updatedAt.toISOString() })) };
    },
    async fraudModels() {
      await init();
      requireFraud();
      return listModels();
    },
    async trainFraudModels() {
      await init();
      requireFraud();
      if (retrainTimer) clearTimeout(retrainTimer);
      retrainTimer = null;
      return trainAll();
    },
    forgetCookie(cookiePath) {
      return cookie ? clearedVisitorCookie({ ...cookie, path: cookie.path ?? cookiePath }) : null;
    },
  };
}

function featureSource(e: StoredEvent): FeatureSource {
  return {
    matchKind: e.matchKind,
    confidence: e.confidence,
    createdAt: e.createdAt,
    results: e.signals.results ?? {},
    linkedVisitors: e.signals.linkedVisitors ?? [],
    timezone: e.signals.attributes?.timezone ?? null,
    account: e.signals.account ?? null,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
