import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { INVITE_DAYS, normalizeEmail } from '../auth/invites.js';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, type ProjectRole, requireProject } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { invalidFields } from '../webhooks/webhook-admin.service.js';

const MAX_MEMBERS = 200;
const RANK: Record<ProjectRole, number> = { viewer: 1, admin: 2, owner: 3 };
const role = z.enum(['viewer', 'admin', 'owner']);
const inviteSchema = z.object({ email: z.string().trim().email().max(254), role }).strict();
const roleSchema = z.object({ role }).strict();

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
  joinedAt: string;
  isYou: boolean;
}
export interface InviteView {
  id: string;
  email: string;
  role: ProjectRole;
  invitedAt: string;
  expiresAt: string;
}
export interface MembersResponse {
  members: MemberView[];
  invites: InviteView[];
}

/**
 * People on a project. Viewers can see the list; admins invite and remove people below owner; owners manage roles and
 * other owners. A project always keeps at least one owner. Invitations are by email: an existing account is added at
 * once, a new address can sign up (even when sign-up is closed) and gets the project when the account exists. Emails
 * are not verified, so an invitation is only as private as the address: revoke it if it was sent to the wrong one.
 */
@Controller('v1/projects/:projectId/members')
export class MembersController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async scope(req: FastifyRequest): Promise<{ projectId: string; userId: string; role: ProjectRole }> {
    const s = requireProject(req);
    await this.rateLimit.enforce([{ key: `api:user:${s.userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 }]);
    return s;
  }

  private async list(projectId: string, me: string): Promise<MembersResponse> {
    const [members, invites] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.projectInvite.findMany({ where: { projectId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      members: members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, joinedAt: m.createdAt.toISOString(), isYou: m.userId === me })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, invitedAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
    };
  }

  private async owners(projectId: string): Promise<number> {
    return this.prisma.projectMember.count({ where: { projectId, role: 'owner' } });
  }

  @Get()
  @Auth('session')
  async members(@Req() req: FastifyRequest): Promise<MembersResponse> {
    const { projectId, userId } = await this.scope(req);
    return this.list(projectId, userId);
  }

  @Post()
  @Auth('session')
  @MinRole('admin')
  @HttpCode(201)
  async invite(@Req() req: FastifyRequest, @Body() body: unknown): Promise<MembersResponse & { result: 'added' | 'invited' }> {
    const { projectId, userId, role: mine } = await this.scope(req);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    if (RANK[parsed.data.role] > RANK[mine]) throw ApiError.forbidden('insufficient_role', `You cannot give a role above your own (${mine})`);
    const email = normalizeEmail(parsed.data.email);
    const [count, pending] = await Promise.all([this.prisma.projectMember.count({ where: { projectId } }), this.prisma.projectInvite.count({ where: { projectId } })]);
    if (count + pending >= MAX_MEMBERS) throw new ApiError(409, 'limit_reached', `At most ${MAX_MEMBERS} people per project`);

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      if (await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: existing.id } } })) {
        throw new ApiError(409, 'already_member', 'That person is already on this project');
      }
      await this.prisma.projectMember.create({ data: { projectId, userId: existing.id, role: parsed.data.role } });
      await this.prisma.projectInvite.deleteMany({ where: { projectId, email } });
      return { ...(await this.list(projectId, userId)), result: 'added' };
    }
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    await this.prisma.projectInvite.upsert({
      where: { projectId_email: { projectId, email } },
      create: { projectId, email, role: parsed.data.role, invitedBy: userId, expiresAt },
      update: { role: parsed.data.role, invitedBy: userId, expiresAt, createdAt: new Date() },
    });
    return { ...(await this.list(projectId, userId)), result: 'invited' };
  }

  @Delete('invites/:inviteId')
  @Auth('session')
  @MinRole('admin')
  async revoke(@Req() req: FastifyRequest, @Param('inviteId') inviteId: string): Promise<MembersResponse> {
    const { projectId, userId } = await this.scope(req);
    const { count } = await this.prisma.projectInvite.deleteMany({ where: { id: /^[0-9a-f-]{36}$/.test(inviteId) ? inviteId : '00000000-0000-0000-0000-000000000000', projectId } });
    if (count === 0) throw ApiError.notFound('Invitation not found');
    return this.list(projectId, userId);
  }

  @Patch(':memberId')
  @Auth('session')
  @MinRole('owner')
  async changeRole(@Req() req: FastifyRequest, @Param('memberId') memberId: string, @Body() body: unknown): Promise<MembersResponse> {
    const { projectId, userId } = await this.scope(req);
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    const target = await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: memberId } } });
    if (!target) throw ApiError.notFound('Member not found');
    if (target.role === 'owner' && parsed.data.role !== 'owner' && (await this.owners(projectId)) <= 1) {
      throw new ApiError(409, 'last_owner', 'A project needs at least one owner. Make someone else an owner first.');
    }
    await this.prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: memberId } }, data: { role: parsed.data.role } });
    return this.list(projectId, userId);
  }

  /** Removes someone, or leaves the project when the member is you. */
  @Delete(':memberId')
  @Auth('session')
  async remove(@Req() req: FastifyRequest, @Param('memberId') memberId: string): Promise<MembersResponse | { left: true }> {
    const { projectId, userId, role: mine } = await this.scope(req);
    const target = await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: memberId } } });
    if (!target) throw ApiError.notFound('Member not found');
    const self = memberId === userId;
    if (!self) {
      if (RANK[mine] < RANK.admin) throw ApiError.forbidden('insufficient_role', 'Requires the admin role');
      if (RANK[target.role] > RANK[mine] || (target.role === 'owner' && mine !== 'owner')) throw ApiError.forbidden('insufficient_role', 'You cannot remove someone with a higher role');
      if (target.role === 'admin' && mine !== 'owner') throw ApiError.forbidden('insufficient_role', 'Only an owner can remove an admin');
    }
    if (target.role === 'owner' && (await this.owners(projectId)) <= 1) {
      throw new ApiError(409, 'last_owner', 'A project needs at least one owner. Make someone else an owner first, or delete the project.');
    }
    await this.prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId: memberId } } });
    return self ? { left: true } : this.list(projectId, userId);
  }
}
