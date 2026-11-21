import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient } from '@prisma/client';
import { TEST_SCORING_CONFIG } from '@trace-id/signals/testing';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { parseEnv } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/infra/prisma-client.js';
import { CidrSet } from '../../src/intel/cidr.js';
import { ListIpIntelProvider } from '../../src/intel/ip-intel.js';
import { type InviteView, type MembersResponse } from '../../src/manage/members.controller.js';

const DATABASE_URL = process.env.DATABASE_URL_TEST;
const DASHBOARD = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const emails = { alice: 'team.alice@example.test', bob: 'team.bob@example.test', carol: 'team.carol@example.test', dave: 'team.dave@example.test' };
type Who = keyof typeof emails;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe.skipIf(!DATABASE_URL)('team, invitations and project deletion (Postgres)', () => {
  let open: NestFastifyApplication;
  let closed: NestFastifyApplication;
  let httpOpen: FastifyInstance;
  let http: FastifyInstance;
  let prisma: PrismaClient;
  const cookies: Partial<Record<Who, string>> = {};
  let projectId = '';
  const ids: Partial<Record<Who, string>> = {};

  const boot = (allowSignup: boolean) =>
    createApp({
      env: parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL,
        TOKEN_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-e2e',
        DASHBOARD_URL: DASHBOARD,
        DASHBOARD_ALLOW_SIGNUP: String(allowSignup),
      }),
      scoring: TEST_SCORING_CONFIG,
      ipIntel: new ListIpIntelProvider(CidrSet.from([]), CidrSet.from([]), CidrSet.from([])),
    });

  const cookieHeader = (res: LightMyRequestResponse): string => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.split(';')[0]).join('; ');
  };
  const signUp = (app: FastifyInstance, who: Who) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { 'content-type': 'application/json', origin: DASHBOARD }, payload: { email: emails[who], password: PASSWORD, name: who } });
  const call = (who: Who, method: Method, url: string, payload?: unknown) =>
    http.inject({ method, url, headers: { ...(cookies[who] ? { cookie: cookies[who] } : {}), origin: DASHBOARD }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const members = (who: Who) => call(who, 'GET', `/v1/projects/${projectId}/members`);
  const roles = async (who: Who): Promise<Record<string, string>> =>
    Object.fromEntries(((await members(who)).json<MembersResponse>().members).map((m) => [m.email.split('@')[0]!.replace('team.', ''), m.role]));

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL as string);
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await prisma.projectInvite.deleteMany({ where: { email: { in: Object.values(emails) } } });
    open = await boot(true);
    closed = await boot(false);
    httpOpen = open.getHttpAdapter().getInstance();
    http = closed.getHttpAdapter().getInstance();
    for (const who of ['alice', 'bob'] as const) {
      const res = await signUp(httpOpen, who);
      expect(res.statusCode).toBe(200);
      cookies[who] = cookieHeader(res);
      ids[who] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[who] } })).id;
    }
  });

  afterAll(async () => {
    await open?.close();
    await closed?.close();
    if (prisma) {
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.projectInvite.deleteMany({ where: { email: { in: Object.values(emails) } } });
      await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
      await prisma.$disconnect();
    }
  });

  it('starts with the creator as the only owner', async () => {
    const created = await call('alice', 'POST', '/v1/projects', { name: 'Team test' });
    expect(created.statusCode).toBe(201);
    projectId = created.json().id;
    const list = (await members('alice')).json<MembersResponse>();
    expect(list.members).toMatchObject([{ email: emails.alice, role: 'owner', isYou: true }]);
    expect(list.invites).toEqual([]);
    expect((await members('carol')).statusCode).toBe(401);
  });

  it('invites a new address, lets it sign up on a closed server, and gives it the project', async () => {
    expect((await signUp(http, 'carol')).statusCode).toBe(403);
    const inv = await call('alice', 'POST', `/v1/projects/${projectId}/members`, { email: emails.carol.toUpperCase(), role: 'viewer' });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toMatchObject({ result: 'invited', invites: [{ email: emails.carol, role: 'viewer' }] });

    const up = await signUp(http, 'carol');
    expect(up.statusCode).toBe(200);
    cookies.carol = cookieHeader(up);
    ids.carol = (await prisma.user.findUniqueOrThrow({ where: { email: emails.carol } })).id;
    expect(await roles('alice')).toEqual({ alice: 'owner', carol: 'viewer' });
    expect((await members('alice')).json<MembersResponse>().invites).toEqual([]);
    expect((await call('carol', 'GET', '/v1/me')).json().projects).toMatchObject([{ id: projectId, role: 'viewer' }]);

  });

  it('adds an existing account at once, and refuses duplicates, bad input and roles above your own', async () => {
    const add = await call('alice', 'POST', `/v1/projects/${projectId}/members`, { email: emails.bob, role: 'admin' });
    expect(add.json()).toMatchObject({ result: 'added' });
    expect(await roles('alice')).toEqual({ alice: 'owner', carol: 'viewer', bob: 'admin' });
    expect((await call('alice', 'POST', `/v1/projects/${projectId}/members`, { email: emails.bob, role: 'viewer' })).statusCode).toBe(409);
    expect((await call('alice', 'POST', `/v1/projects/${projectId}/members`, { email: 'not-an-email', role: 'viewer' })).statusCode).toBe(400);
    expect((await call('alice', 'POST', `/v1/projects/${projectId}/members`, { email: 'x@example.test', role: 'boss' })).statusCode).toBe(400);
    // An admin cannot hand out owner, and a viewer cannot invite at all.
    expect((await call('bob', 'POST', `/v1/projects/${projectId}/members`, { email: 'y@example.test', role: 'owner' })).statusCode).toBe(403);
    expect((await call('carol', 'POST', `/v1/projects/${projectId}/members`, { email: 'y@example.test', role: 'viewer' })).statusCode).toBe(403);
  });

  it('lets only owners change roles, and keeps at least one owner', async () => {
    const url = (who: Who) => `/v1/projects/${projectId}/members/${ids[who]}`;
    expect((await call('bob', 'PATCH', url('carol'), { role: 'admin' })).statusCode).toBe(403);
    expect((await call('alice', 'PATCH', url('carol'), { role: 'admin' })).statusCode).toBe(200);
    expect(await roles('alice')).toMatchObject({ carol: 'admin' });
    const last = await call('alice', 'PATCH', url('alice'), { role: 'viewer' });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('last_owner');
    expect((await call('alice', 'PATCH', url('bob'), { role: 'owner' })).statusCode).toBe(200);
    expect((await call('alice', 'PATCH', url('alice'), { role: 'admin' })).statusCode).toBe(200);
    expect(await roles('bob')).toEqual({ alice: 'admin', carol: 'admin', bob: 'owner' });
    expect((await call('alice', 'PATCH', `/v1/projects/${projectId}/members/${'0'.repeat(8)}-0000-0000-0000-000000000000`, { role: 'viewer' })).statusCode).toBe(403);
  });

  it('lets people be removed within their rank, and leave', async () => {
    const url = (who: Who) => `/v1/projects/${projectId}/members/${ids[who]}`;
    // alice is now an admin: she cannot remove the owner or another admin.
    expect((await call('alice', 'DELETE', url('bob'))).statusCode).toBe(403);
    expect((await call('alice', 'DELETE', url('carol'))).statusCode).toBe(403);
    expect((await call('bob', 'DELETE', url('carol'))).statusCode).toBe(200);
    expect(await roles('bob')).toEqual({ alice: 'admin', bob: 'owner' });
    // The last owner cannot leave.
    const stuck = await call('bob', 'DELETE', url('bob'));
    expect(stuck.statusCode).toBe(409);
    expect(stuck.json().error.code).toBe('last_owner');
    // An admin can leave.
    expect((await call('alice', 'DELETE', url('alice'))).json()).toEqual({ left: true });
    expect((await call('alice', 'GET', `/v1/projects/${projectId}/members`)).statusCode).toBe(404);
  });

  it('revokes an invitation, and an expired one no longer lets anyone in', async () => {
    const inv = await call('bob', 'POST', `/v1/projects/${projectId}/members`, { email: emails.dave, role: 'viewer' });
    const invite = (inv.json() as { invites: InviteView[] }).invites[0]!;
    expect((await call('bob', 'DELETE', `/v1/projects/${projectId}/members/invites/${invite.id}`)).statusCode).toBe(200);
    expect((await call('bob', 'DELETE', `/v1/projects/${projectId}/members/invites/${invite.id}`)).statusCode).toBe(404);

    await call('bob', 'POST', `/v1/projects/${projectId}/members`, { email: emails.dave, role: 'viewer' });
    await prisma.projectInvite.updateMany({ where: { email: emails.dave }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // With no valid invitation left, an address cannot register on a closed server.
    expect((await signUp(http, 'dave')).statusCode).toBe(403);
    expect((await members('bob')).json<MembersResponse>().invites).toEqual([]);
  });

  it('deletes a project only for an owner who types its name, and takes everything with it', async () => {
    const key = await call('bob', 'POST', `/v1/projects/${projectId}/keys`, { type: 'secret' });
    expect(key.statusCode).toBe(201);
    await call('bob', 'POST', `/v1/projects/${projectId}/members`, { email: emails.dave, role: 'viewer' });
    const url = `/v1/projects/${projectId}`;
    expect((await call('bob', 'DELETE', url, {})).statusCode).toBe(400);
    expect((await call('bob', 'DELETE', url, { name: 'team test' })).statusCode).toBe(400);
    expect((await call('bob', 'DELETE', url, { name: 'Team test', extra: 1 })).statusCode).toBe(400);
    expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);

    // An admin who is not an owner is refused: give carol back as admin first.
    await call('bob', 'POST', `/v1/projects/${projectId}/members`, { email: emails.carol, role: 'admin' });
    expect((await call('carol', 'DELETE', url, { name: 'Team test' })).statusCode).toBe(403);
    expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);

    expect((await call('bob', 'DELETE', url, { name: 'Team test' })).statusCode).toBe(204);
    expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
    expect(await prisma.apiKey.count({ where: { projectId } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { projectId } })).toBe(0);
    expect(await prisma.projectInvite.count({ where: { projectId } })).toBe(0);
    expect((await call('bob', 'GET', url)).statusCode).toBe(404);
    projectId = '';
  });
});
