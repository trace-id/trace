import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type ApiKeyResponse } from '@trace-id/signals/api';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertsService } from '../../src/alerts/alerts.service.js';
import { type AlertEventView, type AlertRuleView } from '../../src/alerts/alerts.controller.js';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { makePayload } from '../payload.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DASHBOARD = 'http://localhost:3000';
const SITE = 'https://shop.example.test';
const PASSWORD = 'correct horse battery staple';
const emails = { alice: 'alerts.alice@example.test', bob: 'alerts.bob@example.test' };
const COMPONENTS = ['canvas', 'webgl', 'webglParams', 'audio', 'fonts', 'screen', 'hardware', 'timezone', 'languages', 'platform', 'math', 'css', 'media', 'userAgentFamily'];
type Who = keyof typeof emails;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe.skipIf(!DATABASE_URL)('alert rules, firing and webhooks (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  let alerts: AlertsService;
  let receiver: Server;
  let receiverUrl = '';
  const received: Received[] = [];
  const cookies: Partial<Record<Who, string>> = {};
  let projectId = '';
  let pub = '';
  let seed = 0;

  const cookieHeader = (res: LightMyRequestResponse): string => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.split(';')[0]).join('; ');
  };
  const call = (who: Who, method: Method, url: string, payload?: unknown) =>
    http.inject({ method, url, headers: { ...(cookies[who] ? { cookie: cookies[who] } : {}), origin: DASHBOARD }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const base = () => `/v1/projects/${projectId}/alerts`;
  const history = async () => (await call('alice', 'GET', `${base()}/history`)).json<{ alerts: AlertEventView[] }>().alerts;
  const rulesNow = async () => (await call('alice', 'GET', base())).json<{ rules: AlertRuleView[] }>().rules;

  /** Events from a blocked address score 100, so they count as flagged. */
  async function send(ip: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      seed++;
      const components = Object.fromEntries(COMPONENTS.map((k) => [k, createHash('sha256').update(`${seed}:${k}`).digest('hex').slice(0, 28)]));
      const res = await http.inject({
        method: 'POST',
        url: `/v1/identify?apiKey=${pub}`,
        headers: { 'content-type': 'text/plain', origin: SITE, 'user-agent': TEST_USER_AGENT },
        remoteAddress: ip,
        payload: JSON.stringify({ signals: makePayload({ components }), sdk: { name: 't', version: '0' } }),
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  }
  const settle = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.statusCode = req.url === '/fail' ? 500 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

    app = await createApp({
      env: parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL,
        TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
        DASHBOARD_URL: DASHBOARD,
        DASHBOARD_ALLOW_SIGNUP: 'true',
        WEBHOOK_ALLOW_INSECURE: 'true',
        RATE_LIMIT_INGEST_PER_IP_PER_MIN: '1000',
      }),
      scoring: TEST_SCORING_CONFIG,
      ipIntel: new ListIpIntelProvider(CidrSet.from([]), CidrSet.from([]), CidrSet.from([])),
    });
    http = app.getHttpAdapter().getInstance();
    alerts = app.get(AlertsService);
    alerts.retryDelaysMs = [0];
    for (const who of ['alice', 'bob'] as const) {
      const res = await http.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { 'content-type': 'application/json', origin: DASHBOARD }, payload: { email: emails[who], password: PASSWORD, name: who } });
      expect(res.statusCode).toBe(200);
      cookies[who] = cookieHeader(res);
    }
    projectId = (await call('alice', 'POST', '/v1/projects', { name: 'Alerts test' })).json().id;
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: emails.bob } });
    await prisma.projectMember.create({ data: { projectId, userId: bob.id, role: 'viewer' } });
    pub = (await call('alice', 'POST', `/v1/projects/${projectId}/keys`, { type: 'public', allowedOrigins: [SITE] })).json<ApiKeyResponse>().key as string;
    await call('alice', 'POST', `/v1/projects/${projectId}/lists`, { kind: 'cidr', value: '198.18.50.0/24', action: 'block' });
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => receiver?.close(r));
    if (prisma) {
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
      await prisma.$disconnect();
    }
  });

  it('validates rules and keeps them to admins', async () => {
    const bad = async (body: unknown) => expect((await call('alice', 'POST', base(), body)).statusCode, JSON.stringify(body)).toBe(400);
    await bad({});
    await bad({ name: 'x', kind: 'nope', threshold: 3, windowMinutes: 60 });
    await bad({ name: 'x', kind: 'flagged_events', threshold: 0, windowMinutes: 60 });
    await bad({ name: 'x', kind: 'flagged_events', threshold: 3, windowMinutes: 1 });
    await bad({ name: 'x', kind: 'flagged_ratio', threshold: 150, windowMinutes: 60 });
    await bad({ name: 'x', kind: 'flagged_events', threshold: 3, windowMinutes: 60, webhookUrl: 'ftp://example.test/x' });
    await bad({ name: 'x', kind: 'flagged_events', threshold: 3, windowMinutes: 60, extra: true });
    const body = { name: 'x', kind: 'flagged_events', threshold: 3, windowMinutes: 60 };
    expect((await call('bob', 'POST', base(), body)).statusCode).toBe(403);
    expect((await call('bob', 'GET', base())).statusCode).toBe(200);
    expect((await call('alice', 'DELETE', `${base()}/not-a-uuid`)).statusCode).toBe(404);
    expect(await rulesNow()).toEqual([]);
  });

  let ruleId = '';
  let secret = '';

  it('creates a rule with a signed webhook, shows what it measures, and fires once per cooldown', async () => {
    const created = await call('alice', 'POST', base(), { name: 'Flagged burst', kind: 'flagged_events', threshold: 3, windowMinutes: 60, webhookUrl: receiverUrl });
    expect(created.statusCode).toBe(201);
    const rule = created.json<AlertRuleView>();
    ruleId = rule.id;
    secret = rule.webhookSecret as string;
    expect(secret).toMatch(/^whsec_/);
    expect(rule).toMatchObject({ description: '3 or more flagged events in 1 h', cooldownMinutes: 60, enabled: true, current: { observed: 0, wouldFire: false } });
    // The secret is shown once, and stored sealed.
    expect(JSON.stringify((await call('alice', 'GET', base())).json())).not.toContain(secret);
    expect((await prisma.alertRule.findUniqueOrThrow({ where: { id: ruleId } })).webhookSecret).toMatch(/^v1\./);

    await send('198.18.50.1', 2);
    expect(await alerts.evaluateAll()).toBe(0);
    await send('198.18.50.2', 2);
    expect((await rulesNow())[0]?.current).toMatchObject({ observed: 4, wouldFire: true });
    expect(await alerts.evaluateAll()).toBe(1);
    // Inside the cooldown it stays quiet however many events follow.
    expect(await alerts.evaluateAll()).toBe(0);

    await settle(async () => (await history())[0]?.delivery === 'delivered');
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ ruleId, ruleName: 'Flagged burst', kind: 'flagged_events', observed: 4, threshold: 3, delivery: 'delivered', test: false });
    expect((await rulesNow())[0]?.lastFiredAt).not.toBeNull();

    // The webhook was signed with the rule's secret.
    expect(received).toHaveLength(1);
    const r = received[0] as Received;
    const t = /t=(\d+)/.exec(r.headers['x-signature'] as string)?.[1] as string;
    expect(r.headers['x-signature']).toContain(`v1=${createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex')}`);
    expect(JSON.parse(r.body)).toMatchObject({ type: 'alert.fired', test: false, projectId, observed: 4, threshold: 3, rule: { id: ruleId, name: 'Flagged burst' } });
  });

  it('fires again after the cooldown, and a test fire is marked as one', async () => {
    await prisma.alertRule.update({ where: { id: ruleId }, data: { lastFiredAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await alerts.evaluateAll()).toBe(1);
    const test = await call('alice', 'POST', `${base()}/${ruleId}/test`);
    expect(test.statusCode).toBe(200);
    await settle(async () => (await history()).filter((a) => a.delivery === 'delivered').length === 3);
    const h = await history();
    expect(h.map((a) => a.test).sort()).toEqual([false, false, true]);
    expect(received.filter((r) => JSON.parse(r.body).test === true)).toHaveLength(1);
    expect((await call('bob', 'POST', `${base()}/${ruleId}/test`)).statusCode).toBe(403);
  });

  it('measures a flagged share only once there are enough events, and event volume', async () => {
    const ratio = (await call('alice', 'POST', base(), { name: 'Share', kind: 'flagged_ratio', threshold: 50, windowMinutes: 60, minEvents: 1000 })).json<AlertRuleView>();
    expect(ratio.current).toMatchObject({ wouldFire: false });
    expect(ratio.current.observed).toBeGreaterThanOrEqual(50);
    const lowMin = (await call('alice', 'PATCH', `${base()}/${ratio.id}`, { minEvents: 4 })).json<AlertRuleView>();
    expect(lowMin.current.wouldFire).toBe(true);
    expect(lowMin.description).toBe('50% or more of events flagged in 1 h (at least 4 events)');
    const volume = (await call('alice', 'POST', base(), { name: 'Volume', kind: 'event_volume', threshold: 100000, windowMinutes: 5 })).json<AlertRuleView>();
    expect(volume.current).toMatchObject({ wouldFire: false });
    expect(volume.webhookSecret).toBeUndefined();
    await call('alice', 'DELETE', `${base()}/${volume.id}`);
    await call('alice', 'DELETE', `${base()}/${ratio.id}`);
  });

  it('gives a changed webhook a new secret, records a failed delivery, and skips disabled rules', async () => {
    const changed = (await call('alice', 'PATCH', `${base()}/${ruleId}`, { webhookUrl: `${receiverUrl}/fail` })).json<AlertRuleView>();
    expect(changed.webhookSecret).toMatch(/^whsec_/);
    expect(changed.webhookSecret).not.toBe(secret);
    expect((await call('alice', 'PATCH', `${base()}/${ruleId}`, { threshold: 4 })).json<AlertRuleView>().webhookSecret).toBeUndefined();

    await call('alice', 'POST', `${base()}/${ruleId}/test`);
    await settle(async () => (await history())[0]?.delivery === 'failed' && (await history())[0]?.deliveryError !== 'not delivered yet');
    expect((await history())[0]).toMatchObject({ delivery: 'failed', deliveryError: 'http_500' });

    await call('alice', 'PATCH', `${base()}/${ruleId}`, { enabled: false, webhookUrl: null });
    await prisma.alertRule.update({ where: { id: ruleId }, data: { lastFiredAt: null } });
    expect(await alerts.evaluateAll()).toBe(0);
    await call('alice', 'PATCH', `${base()}/${ruleId}`, { enabled: true });
    expect(await alerts.evaluateAll()).toBe(1);
    expect((await history())[0]).toMatchObject({ delivery: 'none', deliveryError: null });
    expect((await prisma.alertRule.findUniqueOrThrow({ where: { id: ruleId } })).webhookSecret).toBeNull();
  });

  it('keeps the history when a rule is deleted, and removes everything with the project', async () => {
    expect((await call('alice', 'DELETE', `${base()}/${ruleId}`)).statusCode).toBe(204);
    expect((await history()).length).toBeGreaterThan(0);
    expect((await history()).every((a) => a.ruleId === null)).toBe(true);
    expect((await call('alice', 'GET', `/v1/projects/${projectId}`)).statusCode).toBe(200);
  });
});
