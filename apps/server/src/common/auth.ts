import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type FastifyRequest } from 'fastify';
import { KeyService, type ResolvedKey } from '../keys/key.service.js';
import { originAllowed } from '../keys/origins.js';
import { ApiError } from './api-error.js';

export type AuthKind = 'public' | 'secret' | 'none';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ResolvedKey;
    /** Set only after the Origin was checked against the key; the onSend hook reflects it. */
    corsOrigin?: string;
  }
}

const AUTH_KIND = 'auth:kind';

/** Every route must carry this; the global guard rejects routes that do not. */
export const Auth = (kind: AuthKind) => SetMetadata(AUTH_KIND, kind);

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
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: KeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<AuthKind | undefined>(AUTH_KIND, [
      context.getHandler(),
      context.getClass(),
    ]);
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
}

export function requireAuth(req: FastifyRequest): ResolvedKey {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}
