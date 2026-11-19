import { DEFAULT_FLAGGED_NETWORK_CONFIG } from '@trace-id/signals/config';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type IdentifyResponse } from '@trace-id/signals/api';
import { type ScoringConfig } from '@trace-id/signals/config';
import { crawlerVerifierFor } from '../intel/crawler-ranges.js';
import { type SignedAgent, matchKnownAgent } from '@trace-id/signals/agents';
import { deviceRarity } from '@trace-id/signals/rarity';
import { botInfo, evaluateSignals } from '@trace-id/signals/definitions';
import { readDeviceProfile } from '@trace-id/signals/crossbrowser';
import { computeSuspectScore } from '@trace-id/signals/scoring';
import { type RequestHeaders, type TlsInfo } from '@trace-id/signals/types';
import { AccountsService } from '../accounts/accounts.service.js';
import { FraudService } from '../fraud/fraud.service.js';
import { newVisitorId, uuidv7 } from '../common/ids.js';
import { ENV, type Env } from '../config/env.js';
import { SCORING } from '../config/scoring.js';
import { CrossBrowserService, summarizeLinks } from '../crossbrowser/crossbrowser.service.js';
import { type StoredSignals, toEventResponse } from '../events/event-mapper.js';
import { bucketHashes, matchVisitor } from '../identification/engine.js';
import { PrismaCandidateSource } from '../identification/prisma-candidate-source.js';
import { issueToken, verifyToken } from '../identification/token.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { IP_INTEL, type IpIntelProvider } from '../intel/ip-intel.js';
import { ipKey, storableIp } from '../intel/ip-storage.js';
import { type ResolvedKey } from '../keys/key.service.js';
import { VelocityService } from '../velocity/velocity.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';
import { type ParsedIdentifyRequest } from './identify.schema.js';
import { sealResult } from './seal.js';

const MINUTE_MS = 60_000;

export interface IdentifyContext {
  key: ResolvedKey;
  ip: string;
  headers: RequestHeaders;
  /** Visitor token from the first-party cookie, used when the body carries none that verifies. */
  cookieToken?: string | null;
  tls?: TlsInfo | null;
  /** A checked Web Bot Auth signature, when the request carried one. */
  signedAgent?: SignedAgent | null;
  /** Reads a raw request header (lower-case name), for IP sources such as a CDN country header. */
  header?: (name: string) => string | null;
}

/** Deadlock (40P01), serialization failure (40001), lock timeout (55P03), or Prisma's P2034. */
export function isRetryableTxError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 'P2034') return true;
  return typeof e.message === 'string' && /\b(40P01|40001|55P03)\b|deadlock detected/.test(e.message);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class IdentifyService {
  private readonly logger = new Logger('Identify');
  private readonly sealKey: Buffer | null;
  /** Reverse-DNS check for requests that claim to be a search-engine crawler; cached per IP. */
  private readonly verifyCrawler: ReturnType<typeof crawlerVerifierFor>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SCORING) private readonly scoring: ScoringConfig,
    @Inject(IP_INTEL) private readonly ipIntel: IpIntelProvider,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly velocity: VelocityService,
    private readonly webhooks: WebhookService,
    private readonly crossBrowser: CrossBrowserService,
    private readonly accounts: AccountsService,
    private readonly fraud: FraudService,
  ) {
    this.sealKey = env.SEALED_RESULTS_KEY ? Buffer.from(env.SEALED_RESULTS_KEY, 'base64') : null;
    this.verifyCrawler = crawlerVerifierFor(env.CRAWLER_RANGES_FILE, (m) => this.logger.log(m));
  }

  async identify(req: ParsedIdentifyRequest, ctx: IdentifyContext): Promise<IdentifyResponse> {
    const started = performance.now();
    const receivedAt = Date.now();
    const projectId = ctx.key.projectId;
    const hashedIp = ipKey(ctx.ip, this.env.TOKEN_SECRET);

    await this.rateLimit.enforce([
      { key: `ingest:key:${ctx.key.keyId}`, limit: this.env.RATE_LIMIT_INGEST_PER_KEY_PER_MIN, windowMs: MINUTE_MS },
      { key: `ingest:ip:${projectId}:${hashedIp}`, limit: this.env.RATE_LIMIT_INGEST_PER_IP_PER_MIN, windowMs: MINUTE_MS },
    ]);

    const components = req.signals.components;
    const decision = await matchVisitor(
      {
        components,
        tokenVisitorId:
          verifyToken(this.env.TOKEN_SECRET, projectId, req.token) ??
          verifyToken(this.env.TOKEN_SECRET, projectId, ctx.cookieToken ?? undefined),
      },
      new PrismaCandidateSource(this.prisma, projectId),
      this.scoring.identification,
    );
    const visitorId = decision.visitorId ?? newVisitorId();

    if (decision.kind !== 'new') {
      await this.rateLimit.enforce([
        {
          key: `ingest:visitor:${projectId}:${visitorId}`,
          limit: this.env.RATE_LIMIT_INGEST_PER_VISITOR_PER_MIN,
          windowMs: MINUTE_MS,
        },
      ]);
    }

    const ip = await this.ipIntel.lookup(ctx.ip, ctx.header);
    const velocity = await this.velocity.record({
      projectId,
      visitorId,
      ipKey: hashedIp,
      linkedId: req.linkedId ?? null,
      country: ip.country,
    });
    const now = new Date();
    // Offset of the device clock from ours; network latency adds up to a few hundred ms, well under the 2 s that counts.
    const device = readDeviceProfile(req.signals, { clockOffsetMs: req.sentAt === undefined ? null : req.sentAt - receivedAt });
    const netHash = this.crossBrowser.networkKeyFor(ctx.ip);
    const linkedVisitors = netHash ? await this.crossBrowser.findLinks(projectId, visitorId, device, netHash, now) : [];
    const deviceId = await this.crossBrowser.resolveDeviceId(projectId, visitorId, linkedVisitors);
    const linkedId = req.linkedId ?? null;
    const [accounts, accountHistory] = await Promise.all([
      this.accounts.summarize(projectId, visitorId, deviceId, linkedId, now),
      this.accounts.history(projectId, visitorId, deviceId, linkedId),
    ]);
    // Rarity from the project's component statistics; claimed crawlers and agents checked by published IP ranges or reverse DNS.
    const rarity =
      this.scoring.suspect.weights.rareDevice > 0
        ? deviceRarity(components, await new PrismaCandidateSource(this.prisma, projectId).frequencies(components))
        : null;
    const claimed = matchKnownAgent(ctx.headers.userAgent ?? req.signals.attributes.userAgent);
    const crawlerVerified = claimed ? await this.verifyCrawler(ctx.ip, claimed.name) : null;
    // Replay: the first insert of a nonce wins; a second request with it is a replay.
    const replay = req.nonce
      ? {
          nonceSeen:
            (await this.prisma.$executeRaw`INSERT INTO "request_nonces" ("projectId", "nonce", "createdAt") VALUES (${projectId}::uuid, ${req.nonce}, ${now}) ON CONFLICT DO NOTHING`) === 0,
          sentAgoMs: req.sentAt === undefined ? null : receivedAt - req.sentAt,
        }
      : null;
    const flagCfg = this.scoring.flaggedNetwork ?? DEFAULT_FLAGGED_NETWORK_CONFIG;
    const network =
      netHash && this.scoring.suspect.weights.flaggedNetwork > 0
        ? await this.crossBrowser.networkReputation(projectId, visitorId, netHash, now, flagCfg)
        : null;
    const evalCtx = {
      network,
      replay,
      rarity,
      crawlerVerified,
      payload: req.signals,
      headers: ctx.headers,
      ip,
      velocity,
      crossBrowser: netHash ? summarizeLinks(linkedVisitors) : null,
      accounts,
      tls: ctx.tls ?? null,
      now,
      signedAgent: ctx.signedAgent ?? null,
    };
    const results = evaluateSignals(evalCtx, this.scoring);
    const score = computeSuspectScore(results, this.scoring);

    const eventId = uuidv7(now);
    const a = req.signals.attributes;
    const fraudScores = this.fraud.score(await this.fraud.modelsFor(projectId), {
      matchKind: decision.kind,
      confidence: round2(decision.confidence),
      createdAt: now,
      results,
      linkedVisitors,
      timezone: a.timezone,
      account: accountHistory,
    });
    const stored: StoredSignals = {
      results,
      components,
      attributes: {
        screenWidth: a.screenWidth,
        screenHeight: a.screenHeight,
        timezone: a.timezone,
        languages: a.languages,
        platform: a.platform,
        userAgent: a.userAgent,
        webglRenderer: a.webglRenderer,
      },
      sdk: req.sdk,
      collectMs: req.signals.collectMs,
      linkedVisitors,
      deviceId,
      botInfo: botInfo(evalCtx, results.bot.detected),
      ...(ip.location ? { ipLocation: ip.location } : {}),
      raw: req.signals.attributes,
      ...(req.signals.app ? { app: req.signals.app } : {}),
      ...(accountHistory ? { account: accountHistory } : {}),
      ...(fraudScores.length ? { fraudScores } : {}),
    };
    const summary = components as Prisma.InputJsonObject;
    const confidence = round2(decision.confidence);
    const eventRow = {
      id: eventId,
      createdAt: now,
      projectId,
      visitorId,
      matchKind: decision.kind,
      confidence,
      suspectScore: score.score,
      reasons: score.reasons as unknown as Prisma.InputJsonArray,
      signals: stored as unknown as Prisma.InputJsonObject,
      ip: storableIp(ctx.ip, this.env.IP_STORAGE, this.env.TOKEN_SECRET),
      asn: ip.asn,
      country: ip.country,
      tags: req.tags ?? null,
      linkedId: req.linkedId ?? null,
    };
    const eventResponse = toEventResponse(eventRow, this.env.EVENT_VERIFY_WINDOW_MINUTES);
    const deliveries = await this.webhooks.deliveriesFor(projectId, eventResponse, now);

    const persist = () =>
      this.prisma.$transaction([
        this.prisma.visitor.upsert({
          where: { id: visitorId },
          create: { id: visitorId, projectId, firstSeenAt: now, lastSeenAt: now, signalSummary: summary, eventCount: 1, deviceId },
          update: { lastSeenAt: now, signalSummary: summary, eventCount: { increment: 1 }, deviceId },
        }),
        this.prisma.visitorBucket.createMany({
          data: bucketHashes(components, this.scoring.identification.buckets).map((bucketHash) => ({
            projectId,
            bucketHash,
            visitorId,
          })),
          skipDuplicates: true,
        }),
        ...(netHash ? [this.crossBrowser.upsert(projectId, visitorId, device, netHash, now)] : []),
        ...(linkedId ? [this.accounts.upsert(projectId, visitorId, linkedId, now)] : []),
        this.prisma.event.create({ data: { ...eventRow, tags: req.tags ?? undefined } }),
        this.prisma.webhookDelivery.createMany({ data: deliveries }),
      ]);
    try {
      await persist();
    } catch (err) {
      if (!isRetryableTxError(err)) throw err;
      this.logger.warn(`event=${eventId} transaction conflict, retrying once`);
      await persist();
    }

    this.logger.log(
      `event=${eventId} visitor=${visitorId} match=${decision.kind} device=${deviceId} links=${linkedVisitors.length} score=${score.score} ms=${Math.round(performance.now() - started)}`,
    );
    return {
      eventId,
      visitorId,
      deviceId,
      confidence,
      suspectScore: score.score,
      token: issueToken(this.env.TOKEN_SECRET, projectId, visitorId, now),
      ...(this.sealKey ? { sealedResult: sealResult(eventResponse, this.sealKey) } : {}),
    };
  }
}
