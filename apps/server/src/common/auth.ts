import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type FastifyRequest } from 'fastify';
import { AUTH, type Auth as BetterAuth, toHeaders } from '../auth/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { KeyService, type ResolvedKey } from '../keys/key.service.js';
import { originAllowed } from '../keys/origins.js';
import { ApiError } from './api-error.js';

export type AuthKind = 'public' | 'secret' | 'session' | 'none';
export type ProjectRole = 'viewer' | 'admin' | 'owner';

export interface DashboardUser {
  userId: string;
  email: string;
  /** Set on routes with a :projectId param, after the membership check. */
  projectId?: string;
  role?: ProjectRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ResolvedKey;
    dashboardUser?: DashboardUser;
    /** Set only after the Origin was checked against the key; the onSend hook reflects it. */
    corsOrigin?: string;
  }
}

const AUTH_KIND = 'auth:kind';
const MIN_ROLE = 'auth:minRole';
const RANK: Record<ProjectRole, number> = { viewer: 1, admin: 2, owner: 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Every route must carry this; the global guard rejects routes that do not. */
export const Auth = (kind: AuthKind) => SetMetadata(AUTH_KIND, kind);

/** For session routes with :projectId. Defaults to viewer (read-only). */
export const MinRole = (role: ProjectRole) => SetMetadata(MIN_ROLE, role);

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const m = /^Bearer ([\w-]{1,128})$/.exec(header);
  return m?.[1] ?? null;
}

function queryKey(req: FastifyRequest): string | null {
  const value = (req.query as Record<string, unknown> | undefined)?.apiKey;
  return typeof value === 'string' && value.length <= 128 ? value : null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly dashboardOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly keys: KeyService,
    private readonly prisma: PrismaService,
    @Inject(AUTH) private readonly auth: BetterAuth,
    @Inject(ENV) env: Env,
  ) {
    this.dashboardOrigin = new URL(env.DASHBOARD_URL).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const kind = this.reflector.getAllAndOverride<AuthKind | undefined>(AUTH_KIND, targets);
    if (kind === undefined) {
      throw new ApiError(500, 'internal_error', 'Route has no auth declaration');
    }
    if (kind === 'none') return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (kind === 'secret') {
      const key = bearer(req);
      const resolved = key ? await this.keys.resolve(key, 'secret') : null;
      if (!resolved) throw ApiError.unauthorized();
      req.auth = resolved;
      return true;
    }
    if (kind === 'session') {
      req.dashboardUser = await this.session(req, this.reflector.getAllAndOverride<ProjectRole>(MIN_ROLE, targets));
      return true;
    }

    const key = queryKey(req);
    const resolved = key ? await this.keys.resolve(key, 'public') : null;
    if (!resolved) throw ApiError.unauthorized();
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!originAllowed(origin, resolved.allowedOrigins)) {
      throw ApiError.forbidden('origin_not_allowed', 'Origin is not allowed for this key');
    }
    req.auth = resolved;
    req.corsOrigin = origin;
    return true;
  }

  /**
   * Cookie session + CSRF defence: state-changing requests must come from the dashboard's
   * origin (session cookies are also SameSite=Lax). Non-members get 404, not 403, so
   * project ids cannot be probed.
   */
  private async session(req: FastifyRequest, minRole: ProjectRole | undefined): Promise<DashboardUser> {
    if (!SAFE_METHODS.has(req.method) && req.headers.origin !== this.dashboardOrigin) {
      throw ApiError.forbidden('origin_not_allowed', 'Cross-origin request refused');
    }
    const result = await this.auth.api.getSession({ headers: toHeaders(req.headers) });
    if (!result) throw new ApiError(401, 'unauthenticated', 'Sign in required');
    const user: DashboardUser = { userId: result.user.id, email: result.user.email };

    const projectId = (req.params as Record<string, string | undefined>).projectId;
    if (projectId === undefined) return user;
    if (!UUID.test(projectId)) throw ApiError.notFound('Project not found');
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.userId } },
      select: { role: true },
    });
    if (!member) throw ApiError.notFound('Project not found');
    if (RANK[member.role] < RANK[minRole ?? 'viewer']) {
      throw ApiError.forbidden('insufficient_role', `Requires the ${minRole} role`);
    }
    return { ...user, projectId, role: member.role };
  }
}

export function requireAuth(req: FastifyRequest): ResolvedKey {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}

export function requireUser(req: FastifyRequest): DashboardUser {
  if (!req.dashboardUser) throw new ApiError(401, 'unauthenticated', 'Sign in required');
  return req.dashboardUser;
}

export function requireProject(req: FastifyRequest): { userId: string; projectId: string; role: ProjectRole } {
  const u = requireUser(req);
  if (!u.projectId || !u.role) throw ApiError.notFound('Project not found');
  return { userId: u.userId, projectId: u.projectId, role: u.role };
}
