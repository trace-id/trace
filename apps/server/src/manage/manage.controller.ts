import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { type MeResponse, type ProjectResponse } from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, requireProject, requireUser } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { invalidFields } from '../webhooks/webhook-admin.service.js';

const MAX_PROJECTS_PER_USER = 50;

const createProjectSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

/**
 * Dashboard session routes. Attack surface: CSRF (Origin must equal DASHBOARD_URL on writes,
 * SameSite cookies), IDOR (membership checked in the guard, non-members get 404), privilege
 * escalation (role ranks: viewer < admin < owner; writes need admin), abuse (per-user limit).
 */
@Controller('v1')
export class ManageController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async limit(userId: string): Promise<void> {
    await this.rateLimit.enforce([
      { key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
  }

  @Get('me')
  @Auth('session')
  async me(@Req() req: FastifyRequest): Promise<MeResponse> {
    const { userId } = requireUser(req);
    await this.limit(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, memberships: { include: { project: true } } },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      projects: user.memberships
        .map((m) => ({
          id: m.project.id,
          name: m.project.name,
          retentionDays: m.project.retentionDays,
          role: m.role,
          createdAt: m.project.createdAt.toISOString(),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  @Post('projects')
  @Auth('session')
  @HttpCode(201)
  async createProject(@Req() req: FastifyRequest, @Body() body: unknown): Promise<ProjectResponse> {
    const { userId } = requireUser(req);
    await this.limit(userId);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    if ((await this.prisma.projectMember.count({ where: { userId, role: 'owner' } })) >= MAX_PROJECTS_PER_USER) {
      throw new ApiError(409, 'limit_reached', `At most ${MAX_PROJECTS_PER_USER} projects per user`);
    }
    const project = await this.prisma.project.create({
      data: {
        name: parsed.data.name,
        retentionDays: Math.min(30, this.env.RETENTION_MAX_DAYS),
        members: { create: { userId, role: 'owner' } },
      },
    });
    return {
      id: project.id,
      name: project.name,
      retentionDays: project.retentionDays,
      role: 'owner',
      createdAt: project.createdAt.toISOString(),
    };
  }

  @Get('projects/:projectId')
  @Auth('session')
  async getProject(@Req() req: FastifyRequest): Promise<ProjectResponse> {
    const { projectId, role, userId } = requireProject(req);
    await this.limit(userId);
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    return { id: p.id, name: p.name, retentionDays: p.retentionDays, role, createdAt: p.createdAt.toISOString() };
  }

  @Patch('projects/:projectId')
  @Auth('session')
  @MinRole('admin')
  async updateProject(@Req() req: FastifyRequest, @Body() body: unknown): Promise<ProjectResponse> {
    const { projectId, role, userId } = requireProject(req);
    await this.limit(userId);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    if (parsed.data.retentionDays !== undefined && parsed.data.retentionDays > this.env.RETENTION_MAX_DAYS) {
      throw ApiError.badRequest(`retentionDays cannot exceed ${this.env.RETENTION_MAX_DAYS} on this server`);
    }
    const p = await this.prisma.project.update({ where: { id: projectId }, data: parsed.data });
    return { id: p.id, name: p.name, retentionDays: p.retentionDays, role, createdAt: p.createdAt.toISOString() };
  }
}
