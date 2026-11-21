import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { openSecret, sealSecret } from '../webhooks/secret-box.js';
import { sendWebhook } from '../webhooks/sender.js';

export const ALERT_KINDS = ['flagged_events', 'flagged_ratio', 'event_volume'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Events scoring at or above this count as flagged, the same line the dashboard draws. */
export const FLAGGED_SCORE = 70;
export const MAX_RULES = 20;
const TICK_MS = 60_000;

export const ruleFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(ALERT_KINDS),
  threshold: z.number().int().min(1).max(10_000_000),
  windowMinutes: z.number().int().min(5).max(1440),
  minEvents: z.number().int().min(0).max(10_000_000),
  cooldownMinutes: z.number().int().min(5).max(10_080),
  enabled: z.boolean(),
  webhookUrl: z.string().trim().max(2048).nullable(),
};

/** What a rule measured over its window. */
export interface Observation {
  events: number;
  flagged: number;
}

/** Whether a rule fires on this observation, and the number it reports. */
export function evaluateRule(rule: { kind: string; threshold: number; minEvents: number }, o: Observation): { fire: boolean; observed: number } {
  if (rule.kind === 'flagged_events') return { fire: o.flagged >= rule.threshold, observed: o.flagged };
  if (rule.kind === 'event_volume') return { fire: o.events >= rule.threshold, observed: o.events };
  // flagged_ratio: a percentage, and only once there are enough events for it to mean something.
  const pct = o.events > 0 ? Math.round((o.flagged / o.events) * 100) : 0;
  return { fire: o.events >= Math.max(1, rule.minEvents) && pct >= rule.threshold, observed: pct };
}

export function describeRule(rule: { kind: string; threshold: number; windowMinutes: number; minEvents: number }): string {
  const w = rule.windowMinutes >= 60 && rule.windowMinutes % 60 === 0 ? `${rule.windowMinutes / 60} h` : `${rule.windowMinutes} min`;
  if (rule.kind === 'flagged_events') return `${rule.threshold} or more flagged events in ${w}`;
  if (rule.kind === 'event_volume') return `${rule.threshold} or more events in ${w}`;
  return `${rule.threshold}% or more of events flagged in ${w}${rule.minEvents > 0 ? ` (at least ${rule.minEvents} events)` : ''}`;
}

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Alerts');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Waits before each delivery attempt of a webhook. Tests shorten it. */
  retryDelaysMs: number[] = [0, 2_000, 10_000];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.evaluateAll(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async observe(projectId: string, windowMinutes: number, now: Date): Promise<Observation> {
    const from = new Date(now.getTime() - windowMinutes * 60_000);
    const [row] = await this.prisma.$queryRaw<{ events: number; flagged: number }[]>`
      SELECT count(*)::int AS events, (count(*) FILTER (WHERE e."suspectScore" >= ${FLAGGED_SCORE}))::int AS flagged
      FROM "events" e
      WHERE e."projectId" = ${projectId}::uuid AND e."createdAt" >= ${from} AND e."createdAt" <= ${now}`;
    return { events: row?.events ?? 0, flagged: row?.flagged ?? 0 };
  }

  /** Checks every enabled rule once. Safe to run on several instances: only the one that claims the rule fires it. */
  async evaluateAll(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let fired = 0;
    try {
      const rules = await this.prisma.alertRule.findMany({ where: { enabled: true } });
      for (const rule of rules) {
        try {
          if (rule.lastFiredAt && now.getTime() - rule.lastFiredAt.getTime() < rule.cooldownMinutes * 60_000) continue;
          const obs = await this.observe(rule.projectId, rule.windowMinutes, now);
          const verdict = evaluateRule(rule, obs);
          if (!verdict.fire) continue;
          // Claim the firing: if another instance got there first this updates nothing.
          const cutoff = new Date(now.getTime() - rule.cooldownMinutes * 60_000);
          const claimed = await this.prisma.alertRule.updateMany({
            where: { id: rule.id, OR: [{ lastFiredAt: null }, { lastFiredAt: { lte: cutoff } }] },
            data: { lastFiredAt: now },
          });
          if (claimed.count === 0) continue;
          await this.fire(rule, verdict.observed, obs, now, false);
          fired++;
        } catch (err) {
          this.logger.warn(`rule ${rule.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return fired;
  }

  /** Records a firing and delivers the rule's webhook, if it has one, retrying a couple of times in the background. */
  async fire(
    rule: { id: string; projectId: string; name: string; kind: string; threshold: number; windowMinutes: number; minEvents: number; webhookUrl: string | null; webhookSecret: string | null },
    observed: number,
    obs: Observation,
    now: Date,
    test: boolean,
  ): Promise<string> {
    const event = await this.prisma.alertEvent.create({
      data: {
        projectId: rule.projectId,
        ruleId: rule.id,
        ruleName: rule.name,
        kind: rule.kind,
        observed,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        details: { events: obs.events, flagged: obs.flagged, test },
        delivery: rule.webhookUrl ? 'failed' : 'none',
        deliveryError: rule.webhookUrl ? 'not delivered yet' : null,
        firedAt: now,
      },
    });
    this.logger.log(`alert "${rule.name}" fired for project ${rule.projectId}: ${observed} (${describeRule(rule)})${test ? ' [test]' : ''}`);
    if (rule.webhookUrl && rule.webhookSecret) void this.deliver(rule, event.id, observed, obs, now, test);
    return event.id;
  }

  private async deliver(
    rule: { id: string; projectId: string; name: string; kind: string; threshold: number; windowMinutes: number; webhookUrl: string | null; webhookSecret: string | null },
    eventId: string,
    observed: number,
    obs: Observation,
    now: Date,
    test: boolean,
  ): Promise<void> {
    let secret: string;
    try {
      secret = openSecret(rule.webhookSecret as string, this.env.TOKEN_SECRET);
    } catch {
      await this.prisma.alertEvent.update({ where: { id: eventId }, data: { delivery: 'failed', deliveryError: 'secret_unreadable' } }).catch(() => undefined);
      return;
    }
    const body = JSON.stringify({
      id: eventId,
      type: 'alert.fired',
      createdAt: now.toISOString(),
      test,
      projectId: rule.projectId,
      rule: { id: rule.id, name: rule.name, kind: rule.kind, description: describeRule({ ...rule, minEvents: 0 }) },
      observed,
      threshold: rule.threshold,
      windowMinutes: rule.windowMinutes,
      counts: obs,
    });
    let last: string | null = 'not attempted';
    for (const delay of this.retryDelaysMs) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await sendWebhook({
        url: rule.webhookUrl as string,
        body,
        secret,
        deliveryId: eventId || randomUUID(),
        timeoutMs: this.env.WEBHOOK_TIMEOUT_MS,
        allowInsecure: this.env.WEBHOOK_ALLOW_INSECURE,
      });
      if (res.ok) {
        await this.prisma.alertEvent.update({ where: { id: eventId }, data: { delivery: 'delivered', deliveryError: null } }).catch(() => undefined);
        return;
      }
      last = res.error ?? (res.status ? `HTTP ${res.status}` : 'failed');
    }
    await this.prisma.alertEvent.update({ where: { id: eventId }, data: { delivery: 'failed', deliveryError: (last ?? 'failed').slice(0, 200) } }).catch(() => undefined);
  }

  seal(secret: string): string {
    return sealSecret(secret, this.env.TOKEN_SECRET);
  }
}
