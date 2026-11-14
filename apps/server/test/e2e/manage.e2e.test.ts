import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import {
  type ApiKeyResponse,
  type EventResponse,
  type EventSearchResponse,
  type IdentifyResponse,
  type MeResponse,
  type ProjectResponse,
  type UsageResponse,
} from '@tbdname/signals/api';
import { makePayload, TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@tbdname/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { parseEnv } from '../../src/config/env.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DASHBOARD = 'http://localhost:3000';
const SITE = 'https://shop.example.test';
const PASSWORD = 'correct horse battery staple';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

describe.skipIf(!DATABASE_URL)('management API with dashboard sessions (Postgres)', () => {
  let closed: NestFastifyApplication;
  let open: NestFastifyApplication;
  let http: FastifyInstance;
  let httpOpen: FastifyInstance;
  let prisma: PrismaClient;
  const cookies: Record<string, string> = {};
  const emails = ['alice@example.test', 'bob@example.test', 'mallory@example.test'];
  let projectId = '';

  async function boot(allowSignup: boolean): Promise<NestFastifyApplication> {
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL,
      TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
      DASHBOARD_URL: DASHBOARD,
      DASHBOARD_ALLOW_SIGNUP: String(allowSignup),
      RETENTION_MAX_DAYS: '90',
    });
    const none = CidrSet.from([]);
    return createApp({ env, scoring: TEST_SCORING_CONFIG, ipIntel: new ListIpIntelProvider(none, none, none) });
  }

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    closed = await boot(false);
    open = await boot(true);
    http = closed.getHttpAdapter().getInstance();
    httpOpen = open.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await closed?.close();
    await open?.close();
    if (prisma) {
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.$disconnect();
    }
  });

  function cookieHeader(res: LightMyRequestResponse): string {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((c) => c.split(';')[0]).join('; ');
  }

  const signUp = (app: FastifyInstance, email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json', origin: DASHBOARD },
      payload: { email, password: PASSWORD, name: email.split('@')[0] },
    });

  function call(who: string, method: Method, url: string, payload?: unknown, origin: string | null = DASHBOARD) {
    const headers: Record<string, string> = {};
    if (cookies[who]) headers.cookie = cookies[who];
    if (origin) headers.origin = origin;
    return http.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  }

  it('lets the first account sign up and refuses later ones unless sign-up is enabled', async () => {
    const userCountBefore = await prisma.user.count();
    const alice = await signUp(http, emails[0] as string);
    if (userCountBefore === 0) {
      expect(alice.statusCode).toBe(200);
    } else {
      // Another account already exists in this database: the closed server must refuse.
      expect(alice.statusCode).toBe(403);
      const viaOpen = await signUp(httpOpen, emails[0] as string);
      expect(viaOpen.statusCode).toBe(200);
      cookies.alice = cookieHeader(viaOpen);
    }
    cookies.alice ??= cookieHeader(alice);
    expect(cookies.alice).toContain('session_token');

    expect((await signUp(http, emails[1] as string)).statusCode).toBe(403);
    const bob = await signUp(httpOpen, emails[1] as string);
    expect(bob.statusCode).toBe(200);
    cookies.bob = cookieHeader(bob);
  });

  it('requires a session and blocks cross-origin writes', async () => {
    expect((await call('nobody', 'GET', '/v1/me')).statusCode).toBe(401);
    expect((await call('alice', 'POST', '/v1/projects', { name: 'Shop' }, null)).statusCode).toBe(403);
    expect((await call('alice', 'POST', '/v1/projects', { name: 'Shop' }, 'https://evil.test')).statusCode).toBe(403);

    const created = await call('alice', 'POST', '/v1/projects', { name: 'Shop' });
    expect(created.statusCode).toBe(201);
    projectId = created.json<ProjectResponse>().id;

    const me = (await call('alice', 'GET', '/v1/me')).json<MeResponse>();
    expect(me.projects.map((p) => [p.id, p.role])).toContainEqual([projectId, 'owner']);
  });

  it('hides projects from non-members and enforces roles', async () => {
    expect((await call('bob', 'GET', `/v1/projects/${projectId}`)).statusCode).toBe(404);
    expect((await call('bob', 'GET', `/v1/projects/${projectId}/keys`)).statusCode).toBe(404);
    const bobId = (await prisma.user.findUniqueOrThrow({ where: { email: emails[1] } })).id;
    await prisma.projectMember.create({ data: { projectId, userId: bobId, role: 'viewer' } });
    expect((await call('bob', 'GET', `/v1/projects/${projectId}/keys`)).statusCode).toBe(200);
    const denied = await call('bob', 'POST', `/v1/projects/${projectId}/keys`, { type: 'secret' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'insufficient_role' } });
    expect((await call('bob', 'PATCH', `/v1/projects/${projectId}`, { name: 'x' })).statusCode).toBe(403);
  });

  it('creates keys once-visible, and revocation takes effect immediately', async () => {
    const pubRes = await call('alice', 'POST', `/v1/projects/${projectId}/keys`, {
      type: 'public',
      name: 'site',
      allowedOrigins: [SITE],
    });
    expect(pubRes.statusCode).toBe(201);
    const pub = pubRes.json<ApiKeyResponse>();
    expect(pub.key).toMatch(/^pk_/);
    const sec = (await call('alice', 'POST', `/v1/projects/${projectId}/keys`, { type: 'secret' })).json<ApiKeyResponse>();

    const listed = JSON.stringify((await call('alice', 'GET', `/v1/projects/${projectId}/keys`)).json());
    expect(listed).not.toContain(pub.key as string);
    expect(listed).not.toContain(sec.key as string);

    expect(
      (await call('alice', 'POST', `/v1/projects/${projectId}/keys`, { type: 'public', allowedOrigins: ['*'] })).statusCode,
    ).toBe(400);

    const identify = (bot = false) =>
      http.inject({
        method: 'POST',
        url: `/v1/identify?apiKey=${pub.key}`,
        headers: { 'content-type': 'text/plain', origin: SITE, 'user-agent': TEST_USER_AGENT },
        payload: JSON.stringify({
          signals: makePayload({ components: { canvas: 'ab'.repeat(14), audio: 'cd'.repeat(14) }, bot: { webdriver: bot } }),
          sdk: { name: 't', version: '0' },
          linkedId: 'user-42',
        }),
      });
    const ok = await identify();
    expect(ok.statusCode).toBe(200);
    const flagged = (await identify(true)).json<IdentifyResponse>();

    const search = (await call('alice', 'GET', `/v1/projects/${projectId}/events?minScore=50`)).json<EventSearchResponse>();
    expect(search.events.map((e) => e.eventId)).toEqual([flagged.eventId]);
    const byLinked = (await call('alice', 'GET', `/v1/projects/${projectId}/events?linkedId=user-42&limit=1`)).json<EventSearchResponse>();
    expect(byLinked.events).toHaveLength(1);
    expect(byLinked.nextCursor).not.toBeNull();
    expect((await call('alice', 'GET', `/v1/projects/${projectId}/events?bogus=1`)).statusCode).toBe(400);

    const detail = (await call('bob', 'GET', `/v1/projects/${projectId}/events/${flagged.eventId}`)).json<EventResponse>();
    expect(detail.reasons[0]?.signal).toBe('bot');

    const usage = (await call('alice', 'GET', `/v1/projects/${projectId}/usage?days=7`)).json<UsageResponse>();
    expect(usage.days).toHaveLength(7);
    expect(usage.days[6]).toMatchObject({ events: 2, suspicious: 0 });

    expect((await call('alice', 'POST', `/v1/projects/${projectId}/keys/${pub.id}/revoke`)).statusCode).toBe(201);
    expect((await identify()).statusCode).toBe(401);
  });

  it('rate-limits password guessing, and forged X-Forwarded-For does not reset the limit', async () => {
    const attempt = (i: number) =>
      http.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json', origin: DASHBOARD, 'x-forwarded-for': `198.51.100.${i}` },
        payload: { email: emails[2], password: `wrong-password-${i}` },
        remoteAddress: '203.0.113.50',
      });
    const statuses: number[] = [];
    for (let i = 1; i <= 12; i++) statuses.push((await attempt(i)).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 401 || s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('validates project settings against server limits', async () => {
    expect((await call('alice', 'PATCH', `/v1/projects/${projectId}`, { retentionDays: 365 })).statusCode).toBe(400);
    const updated = await call('alice', 'PATCH', `/v1/projects/${projectId}`, { retentionDays: 14, name: 'Shop EU' });
    expect(updated.json<ProjectResponse>()).toMatchObject({ retentionDays: 14, name: 'Shop EU' });
    expect((await call('alice', 'PATCH', `/v1/projects/${projectId}`, { owner: 'me' })).statusCode).toBe(400);
  });
});
