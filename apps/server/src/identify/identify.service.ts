import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type IdentifyResponse } from '@tbdname/signals/api';
import { type ScoringConfig } from '@tbdname/signals/config';
import { evaluateSignals } from '@tbdname/signals/definitions';
import { computeSuspectScore } from '@tbdname/signals/scoring';
import { type RequestHeaders } from '@tbdname/signals/types';
import { newVisitorId, uuidv7 } from '../common/ids.js';
import { ENV, type Env } from '../config/env.js';
import { SCORING } from '../config/scoring.js';
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

const MINUTE_MS = 60_000;

export interface IdentifyContext {
  key: ResolvedKey;
  ip: string;
  headers: RequestHeaders;
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

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SCORING) private readonly scoring: ScoringConfig,
    @Inject(IP_INTEL) private readonly ipIntel: IpIntelProvider,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly velocity: VelocityService,
    private readonly webhooks: WebhookService,
  ) {}

  async identify(req: ParsedIdentifyRequest, ctx: IdentifyContext): Promise<IdentifyResponse> {
    const started = performance.now();
    const projectId = ctx.key.projectId;
    const hashedIp = ipKey(ctx.ip, this.env.TOKEN_SECRET);

    await this.rateLimit.enforce([
      { key: `ingest:key:${ctx.key.keyId}`, limit: this.env.RATE_LIMIT_INGEST_PER_KEY_PER_MIN, windowMs: MINUTE_MS },
      { key: `ingest:ip:${projectId}:${hashedIp}`, limit: this.env.RATE_LIMIT_INGEST_PER_IP_PER_MIN, windowMs: MINUTE_MS },
    ]);

    const components = req.signals.components;
    const decision = await matchVisitor(
      { components, tokenVisitorId: verifyToken(this.env.TOKEN_SECRET, projectId, req.token) },
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

    const ip = this.ipIntel.lookup(ctx.ip);
    const velocity = await this.velocity.record({
      projectId,
      visitorId,
      ipKey: hashedIp,
      linkedId: req.linkedId ?? null,
    });
    const results = evaluateSignals({ payload: req.signals, headers: ctx.headers, ip, velocity }, this.scoring);
    const score = computeSuspectScore(results, this.scoring);

    const now = new Date();
    const eventId = uuidv7(now);
    const a = req.signals.attributes;
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
    const deliveries = await this.webhooks.deliveriesFor(
      projectId,
      toEventResponse(eventRow, this.env.EVENT_VERIFY_WINDOW_MINUTES),
      now,
    );

    const persist = () =>
      this.prisma.$transaction([
        this.prisma.visitor.upsert({
          where: { id: visitorId },
          create: { id: visitorId, projectId, firstSeenAt: now, lastSeenAt: now, signalSummary: summary, eventCount: 1 },
          update: { lastSeenAt: now, signalSummary: summary, eventCount: { increment: 1 } },
        }),
        this.prisma.visitorBucket.createMany({
          data: bucketHashes(components, this.scoring.identification.buckets).map((bucketHash) => ({
            projectId,
            bucketHash,
            visitorId,
          })),
          skipDuplicates: true,
        }),
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
      `event=${eventId} visitor=${visitorId} match=${decision.kind} score=${score.score} ms=${Math.round(performance.now() - started)}`,
    );
    return {
      eventId,
      visitorId,
      confidence,
      suspectScore: score.score,
      token: issueToken(this.env.TOKEN_SECRET, projectId, visitorId, now),
    };
  }
}
