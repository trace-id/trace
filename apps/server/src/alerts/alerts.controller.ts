import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, requireProject } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { validateWebhookUrl } from '../webhooks/net-guard.js';
import { invalidFields } from '../webhooks/webhook-admin.service.js';
import { AlertsService, describeRule, evaluateRule, MAX_RULES, ruleFields } from './alerts.service.js';

const createSchema = z
  .object({ ...ruleFields })
  .partial({ minEvents: true, cooldownMinutes: true, enabled: true, webhookUrl: true })
  .strict();
const updateSchema = z.object({ ...ruleFields }).partial().strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AlertRuleView {
  id: string;
  name: string;
  kind: string;
  description: string;
  threshold: number;
  windowMinutes: number;
  minEvents: number;
  cooldownMinutes: number;
  enabled: boolean;
  webhookUrl: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  /** What the rule measures right now, and whether that would fire it. */
  current: { observed: number; wouldFire: boolean; events: number; flagged: number };
  /** The webhook signing secret. Only in the response that created or changed the webhook. */
  webhookSecret?: string;
}

export interface AlertEventView {
  id: string;
  ruleId: string | null;
  ruleName: string;
  kind: string;
  observed: number;
  threshold: number;
  windowMinutes: number;
  delivery: string;
  deliveryError: string | null;
  test: boolean;
  firedAt: string;
}

/**
 * Alert rules for a project: when flagged events, the flagged share or the event volume cross a line within a time
 * window, the alert is recorded (and shown in the dashboard) and, if the rule has a webhook, sent signed like a
 * regular webhook. A rule stays quiet for its cooldown after firing. Writes need the admin role.
 */
@Controller('v1/projects/:projectId/alerts')
export class AlertsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly alerts: AlertsService,
  ) {}

  private async scope(req: FastifyRequest): Promise<string> {
    const { projectId, userId } = requireProject(req);
    await this.rateLimit.enforce([{ key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 }]);
    return projectId;
  }

  private checkUrl(url: string | null | undefined): void {
    if (!url) return;
    const check = validateWebhookUrl(url, this.env.WEBHOOK_ALLOW_INSECURE);
    if (!check.ok) throw ApiError.badRequest(check.message, 'invalid_url');
  }

  private async view(
    r: { id: string; name: string; kind: string; threshold: number; windowMinutes: number; minEvents: number; cooldownMinutes: number; enabled: boolean; webhookUrl: string | null; lastFiredAt: Date | null; createdAt: Date },
    projectId: string,
    secret?: string,
  ): Promise<AlertRuleView> {
    const obs = await this.alerts.observe(projectId, r.windowMinutes, new Date());
    const verdict = evaluateRule(r, obs);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      description: describeRule(r),
      threshold: r.threshold,
      windowMinutes: r.windowMinutes,
      minEvents: r.minEvents,
      cooldownMinutes: r.cooldownMinutes,
      enabled: r.enabled,
      webhookUrl: r.webhookUrl,
      lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      current: { observed: verdict.observed, wouldFire: verdict.fire, events: obs.events, flagged: obs.flagged },
      ...(secret ? { webhookSecret: secret } : {}),
    };
  }

  private async find(projectId: string, ruleId: string) {
    if (!UUID.test(ruleId)) throw ApiError.notFound('Rule not found');
    const rule = await this.prisma.alertRule.findFirst({ where: { id: ruleId, projectId } });
    if (!rule) throw ApiError.notFound('Rule not found');
    return rule;
  }

  @Get()
  @Auth('session')
  async rules(@Req() req: FastifyRequest): Promise<{ rules: AlertRuleView[]; limit: number }> {
    const projectId = await this.scope(req);
    const rows = await this.prisma.alertRule.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return { rules: await Promise.all(rows.map((r) => this.view(r, projectId))), limit: MAX_RULES };
  }

  @Get('history')
  @Auth('session')
  async history(@Req() req: FastifyRequest): Promise<{ alerts: AlertEventView[] }> {
    const projectId = await this.scope(req);
    const rows = await this.prisma.alertEvent.findMany({ where: { projectId }, orderBy: { firedAt: 'desc' }, take: 100 });
    return {
      alerts: rows.map((e) => ({
        id: e.id,
        ruleId: e.ruleId,
        ruleName: e.ruleName,
        kind: e.kind,
        observed: e.observed,
        threshold: e.threshold,
        windowMinutes: e.windowMinutes,
        delivery: e.delivery,
        deliveryError: e.deliveryError,
        test: (e.details as { test?: boolean } | null)?.test === true,
        firedAt: e.firedAt.toISOString(),
      })),
    };
  }

  @Post()
  @Auth('session')
  @MinRole('admin')
  @HttpCode(201)
  async create(@Req() req: FastifyRequest, @Body() body: unknown): Promise<AlertRuleView> {
    const projectId = await this.scope(req);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    const d = parsed.data;
    if ((await this.prisma.alertRule.count({ where: { projectId } })) >= MAX_RULES) throw new ApiError(409, 'limit_reached', `At most ${MAX_RULES} rules per project`);
    this.checkUrl(d.webhookUrl);
    if (d.kind === 'flagged_ratio' && d.threshold > 100) throw ApiError.badRequest('A ratio is a percentage from 1 to 100', 'invalid_rule');
    const secret = d.webhookUrl ? `whsec_${randomBytes(24).toString('base64url')}` : null;
    const r = await this.prisma.alertRule.create({
      data: {
        projectId,
        name: d.name,
        kind: d.kind,
        threshold: d.threshold,
        windowMinutes: d.windowMinutes,
        minEvents: d.minEvents ?? 0,
        cooldownMinutes: d.cooldownMinutes ?? 60,
        enabled: d.enabled ?? true,
        webhookUrl: d.webhookUrl ?? null,
        webhookSecret: secret ? this.alerts.seal(secret) : null,
      },
    });
    return this.view(r, projectId, secret ?? undefined);
  }

  @Patch(':ruleId')
  @Auth('session')
  @MinRole('admin')
  async update(@Req() req: FastifyRequest, @Param('ruleId') ruleId: string, @Body() body: unknown): Promise<AlertRuleView> {
    const projectId = await this.scope(req);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    const current = await this.find(projectId, ruleId);
    const d = parsed.data;
    this.checkUrl(d.webhookUrl);
    const kind = d.kind ?? current.kind;
    if (kind === 'flagged_ratio' && (d.threshold ?? current.threshold) > 100) throw ApiError.badRequest('A ratio is a percentage from 1 to 100', 'invalid_rule');
    // A new or changed webhook address gets a new secret; clearing it removes the secret.
    let secret: string | null = null;
    const webhook: { webhookUrl?: string | null; webhookSecret?: string | null } = {};
    if (d.webhookUrl !== undefined) {
      webhook.webhookUrl = d.webhookUrl || null;
      if (!d.webhookUrl) webhook.webhookSecret = null;
      else if (d.webhookUrl !== current.webhookUrl || !current.webhookSecret) {
        secret = `whsec_${randomBytes(24).toString('base64url')}`;
        webhook.webhookSecret = this.alerts.seal(secret);
      }
    }
    const { webhookUrl: _ignored, ...rest } = d;
    const r = await this.prisma.alertRule.update({ where: { id: ruleId }, data: { ...rest, ...webhook } });
    return this.view(r, projectId, secret ?? undefined);
  }

  @Delete(':ruleId')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param('ruleId') ruleId: string): Promise<void> {
    const projectId = await this.scope(req);
    await this.find(projectId, ruleId);
    await this.prisma.alertRule.delete({ where: { id: ruleId } });
  }

  /** Fires the rule now with what it measures at the moment, marked as a test, so the webhook can be checked. */
  @Post(':ruleId/test')
  @Auth('session')
  @MinRole('admin')
  @HttpCode(200)
  async test(@Req() req: FastifyRequest, @Param('ruleId') ruleId: string): Promise<{ alertId: string }> {
    const projectId = await this.scope(req);
    const rule = await this.find(projectId, ruleId);
    const now = new Date();
    const obs = await this.alerts.observe(projectId, rule.windowMinutes, now);
    const alertId = await this.alerts.fire(rule, evaluateRule(rule, obs).observed, obs, now, true);
    return { alertId };
  }
}
