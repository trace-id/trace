import { createHash } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { type ApiKeyResponse, type EventResponse, type IdentifyResponse } from '@trace-id/signals/api';
import { TEST_SCORING_CONFIG, TEST_USER_AGENT } from '@trace-id/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { ListsService } from '../../src/lists/lists.service.js';
import { makePayload } from '../payload.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DASHBOARD = 'http://localhost:3000';
const SITE = 'https://shop.example.test';
const PASSWORD = 'correct horse battery staple';
const emails = { alice: 'lists.alice@example.test', bob: 'lists.bob@example.test' };
type Who = keyof typeof emails;
const COMPONENTS = ['canvas', 'webgl', 'webglParams', 'audio', 'fonts', 'screen', 'hardware', 'timezone', 'languages', 'platform', 'math', 'css', 'media', 'userAgentFamily'];
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe.skipIf(!DATABASE_URL)('allow and block lists (Postgres)', () => {
  let app: NestFastifyApplication;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  const cookies: Partial<Record<Who, string>> = {};
  let projectId = '';
  let pub = '';
  let sec = '';
  let n = 0;

  const cookieHeader = (res: LightMyRequestResponse): string => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.split(';')[0]).join('; ');
  };
  const call = (who: Who, method: Method, url: string, payload?: unknown) =>
    http.inject({ method, url, headers: { ...(cookies[who] ? { cookie: cookies[who] } : {}), origin: DASHBOARD }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const add = (body: unknown, who: Who = 'alice') => call(who, 'POST', `/v1/projects/${projectId}/lists`, body);

  /** One identify from an address; each call is a different device so lists, not matching, decide. */
  async function identify(ip: string, opts: { bot?: boolean; linkedId?: string; device?: number; token?: string } = {}): Promise<{ id: IdentifyResponse; event: EventResponse }> {
    n++;
    const seed = opts.device ?? n;
    const hex = (k: string) => createHash('sha256').update(`${seed}:${k}`).digest('hex').slice(0, 28);
    // Enough components for the matcher to treat a returning device as the same one.
    const components = Object.fromEntries(COMPONENTS.map((k) => [k, hex(k)]));
    const res = await http.inject({
      method: 'POST',
      url: `/v1/identify?apiKey=${pub}`,
      headers: { 'content-type': 'text/plain', origin: SITE, 'user-agent': TEST_USER_AGENT },
      remoteAddress: ip,
      payload: JSON.stringify({
        signals: makePayload({ components, bot: { webdriver: opts.bot ?? false } }),
        sdk: { name: 't', version: '0' },
        ...(opts.linkedId ? { linkedId: opts.linkedId } : {}),
        ...(opts.token ? { token: opts.token } : {}),
      }),
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json<IdentifyResponse>();
    const ev = await http.inject({ method: 'GET', url: `/v1/events/${id.eventId}`, headers: { authorization: `Bearer ${sec}` } });
    return { id, event: ev.json<EventResponse>() };
  }

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    app = await createApp({
      env: parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL,
        TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
        DASHBOARD_URL: DASHBOARD,
        DASHBOARD_ALLOW_SIGNUP: 'true',
        RATE_LIMIT_INGEST_PER_IP_PER_MIN: '1000',
      }),
      scoring: TEST_SCORING_CONFIG,
      ipIntel: new ListIpIntelProvider(CidrSet.from([]), CidrSet.from([]), CidrSet.from([])),
    });
    http = app.getHttpAdapter().getInstance();
    for (const who of ['alice', 'bob'] as const) {
      const res = await http.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { 'content-type': 'application/json', origin: DASHBOARD }, payload: { email: emails[who], password: PASSWORD, name: who } });
      expect(res.statusCode).toBe(200);
      cookies[who] = cookieHeader(res);
    }
    projectId = (await call('alice', 'POST', '/v1/projects', { name: 'Lists test' })).json().id;
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: emails.bob } });
    await prisma.projectMember.create({ data: { projectId, userId: bob.id, role: 'viewer' } });
    pub = (await call('alice', 'POST', `/v1/projects/${projectId}/keys`, { type: 'public', allowedOrigins: [SITE] })).json<ApiKeyResponse>().key as string;
    sec = (await call('alice', 'POST', `/v1/projects/${projectId}/keys`, { type: 'secret' })).json<ApiKeyResponse>().key as string;
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
      await prisma.$disconnect();
    }
  });

  it('scores normally until something is listed', async () => {
    const clean = await identify('198.18.10.1');
    expect(clean.event.suspectScore).toBe(0);
    expect(clean.event.list).toBeUndefined();
    const bot = await identify('198.18.10.2', { bot: true });
    expect(bot.event.suspectScore).toBeGreaterThan(0);
    expect(bot.event.suspectScore).toBeLessThan(100);
  });

  it('blocks an address: the score becomes 100 and the signal score is kept', async () => {
    expect((await identify('198.18.11.1', { bot: true })).event.suspectScore).toBeLessThan(100);
    const created = await add({ kind: 'ip', value: '198.18.11.1', action: 'block', note: 'scraper' });
    expect(created.statusCode).toBe(201);
    const { id, event } = await identify('198.18.11.1', { bot: true });
    expect(id.suspectScore).toBe(100);
    expect(event.suspectScore).toBe(100);
    expect(event.list).toMatchObject({ action: 'block', kind: 'ip', value: '198.18.11.1', note: 'scraper' });
    expect(event.list?.scoreBefore).toBeGreaterThan(0);
    expect(event.list?.scoreBefore).toBeLessThan(100);
    expect(event.reasons[0]?.signal).toBe('bot');
    // Another address is untouched.
    expect((await identify('198.18.11.2')).event.list).toBeUndefined();
  });

  it('lets an allow entry sit inside a blocked range, and allow wins', async () => {
    await add({ kind: 'cidr', value: '198.18.12.0/24', action: 'block' });
    await add({ kind: 'ip', value: '198.18.12.7', action: 'allow', note: 'office' });
    expect((await identify('198.18.12.9')).event).toMatchObject({ suspectScore: 100, list: { action: 'block', kind: 'cidr' } });
    expect((await identify('198.18.12.7', { bot: true })).event).toMatchObject({ suspectScore: 0, list: { action: 'allow', kind: 'ip', note: 'office' } });
    expect((await identify('198.18.13.1')).event.list).toBeUndefined();
  });

  it('matches a linked id and a visitor id, whatever the address', async () => {
    await add({ kind: 'linked', value: 'user-banned-1', action: 'block' });
    expect((await identify('198.18.14.1', { linkedId: 'user-banned-1' })).event).toMatchObject({ suspectScore: 100, list: { kind: 'linked' } });
    expect((await identify('198.18.14.2', { linkedId: 'user-fine' })).event.list).toBeUndefined();
    const probe = await identify('198.18.14.3', { device: 9001 });
    await add({ kind: 'visitor', value: probe.id.visitorId, action: 'block' });
    expect((await identify('198.18.14.3', { device: 9001, token: probe.id.token })).event.list).toMatchObject({ action: 'block', kind: 'visitor' });
    await add({ kind: 'device', value: probe.id.deviceId, action: 'allow' });
    expect((await identify('198.18.14.3', { bot: true, device: 9001, token: probe.id.token })).event.list).toMatchObject({ action: 'allow', kind: 'device' });
  });

  it('validates entries and changes an existing one instead of duplicating it', async () => {
    for (const bad of [
      { kind: 'ip', value: 'not-an-ip', action: 'block' },
      { kind: 'ip', value: '10.0.0.0/8', action: 'block' },
      { kind: 'cidr', value: '198.18.0.0', action: 'block' },
      { kind: 'cidr', value: '198.18.0.0/99', action: 'block' },
      { kind: 'visitor', value: 'x', action: 'block' },
      { kind: 'nope', value: 'x', action: 'block' },
      { kind: 'ip', value: '198.18.15.1', action: 'maybe' },
      { kind: 'ip', value: '198.18.15.1', action: 'block', extra: 1 },
    ]) {
      expect((await add(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    await add({ kind: 'ip', value: '198.18.15.1', action: 'block', note: 'first' });
    await add({ kind: 'ip', value: '198.18.15.1', action: 'allow', note: 'changed' });
    const all = (await call('alice', 'GET', `/v1/projects/${projectId}/lists`)).json().entries as { value: string; action: string; note: string }[];
    expect(all.filter((e) => e.value === '198.18.15.1')).toEqual([expect.objectContaining({ action: 'allow', note: 'changed' })]);
    expect((await call('alice', 'GET', `/v1/projects/${projectId}/lists?action=allow`)).json().entries.every((e: { action: string }) => e.action === 'allow')).toBe(true);
    expect((await call('alice', 'GET', `/v1/projects/${projectId}/lists?action=maybe`)).statusCode).toBe(400);
  });

  it('removes an entry at once, and an expired entry stops matching', async () => {
    const e = (await add({ kind: 'ip', value: '198.18.16.1', action: 'block' })).json();
    expect((await identify('198.18.16.1')).event.suspectScore).toBe(100);
    expect((await call('alice', 'DELETE', `/v1/projects/${projectId}/lists/${e.id}`)).statusCode).toBe(204);
    expect((await identify('198.18.16.1')).event.list).toBeUndefined();
    expect((await call('alice', 'DELETE', `/v1/projects/${projectId}/lists/${e.id}`)).statusCode).toBe(404);

    const t = (await add({ kind: 'ip', value: '198.18.16.2', action: 'block', expiresInDays: 1 })).json();
    expect(t.expiresAt).not.toBeNull();
    await prisma.listEntry.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    app.get(ListsService).invalidate(projectId);
    expect((await identify('198.18.16.2')).event.list).toBeUndefined();
    expect(((await call('alice', 'GET', `/v1/projects/${projectId}/lists`)).json().entries as { value: string }[]).some((x) => x.value === '198.18.16.2')).toBe(false);
  });

  it('counts how often an entry decided an event', async () => {
    const e = (await add({ kind: 'ip', value: '198.18.17.1', action: 'block' })).json();
    for (let i = 0; i < 3; i++) await identify('198.18.17.1');
    await app.get(ListsService).flush();
    const row = (await call('alice', 'GET', `/v1/projects/${projectId}/lists`)).json().entries.find((x: { id: string }) => x.id === e.id);
    expect(row.hits).toBe(3);
    expect(row.lastHitAt).not.toBeNull();
  });

  it('lets viewers read the lists but not change them', async () => {
    expect((await call('bob', 'GET', `/v1/projects/${projectId}/lists`)).statusCode).toBe(200);
    expect((await add({ kind: 'ip', value: '198.18.18.1', action: 'block' }, 'bob')).statusCode).toBe(403);
    const some = (await call('alice', 'GET', `/v1/projects/${projectId}/lists`)).json().entries[0];
    expect((await call('bob', 'DELETE', `/v1/projects/${projectId}/lists/${some.id}`)).statusCode).toBe(403);
    expect((await call('alice', 'GET', '/v1/projects/00000000-0000-0000-0000-000000000000/lists')).statusCode).toBe(404);
  });
});
