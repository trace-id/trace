import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { type ApiKeyResponse } from '@tbdname/signals/api';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import { Auth, MinRole, requireProject } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { generateKey } from '../keys/key-crypto.js';
import { KeyService } from '../keys/key.service.js';
import { isValidOriginPattern } from '../keys/origins.js';
import { invalidFields } from '../webhooks/webhook-admin.service.js';

const MAX_KEYS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const origins = z
  .array(z.string().max(255).refine(isValidOriginPattern, 'must be an origin like https://app.example.com'))
  .max(50);

const createSchema = z
  .object({ type: z.enum(['public', 'secret']), name: z.string().trim().max(200).optional(), allowedOrigins: origins.optional() })
  .strict();
const updateSchema = z.object({ name: z.string().trim().max(200).optional(), allowedOrigins: origins.optional() }).strict();

interface KeyRow {
  id: string;
  type: 'public' | 'secret';
  name: string | null;
  prefix: string;
  allowedOrigins: string[];
  createdAt: Date;
  revokedAt: Date | null;
}

function toResponse(k: KeyRow, key?: string): ApiKeyResponse {
  return {
    id: k.id,
    type: k.type,
    name: k.name,
    prefix: k.prefix,
    allowedOrigins: k.allowedOrigins,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt?.toISOString() ?? null,
    ...(key ? { key } : {}),
  };
}

/**
 * Attack surface: key disclosure (full key returned once at creation, only hashes stored,
 * lists show prefixes), IDOR (key ids scoped by project), privilege (admin role for writes;
 * viewers can list but not create or revoke).
 */
@Controller('v1/projects/:projectId/keys')
export class ProjectKeysController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly keys: KeyService,
  ) {}

  private async scope(req: FastifyRequest): Promise<string> {
    const { projectId, userId } = requireProject(req);
    await this.rateLimit.enforce([
      { key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return projectId;
  }

  private async find(projectId: string, keyId: string): Promise<KeyRow> {
    if (!UUID.test(keyId)) throw ApiError.notFound('Key not found');
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, projectId } });
    if (!key) throw ApiError.notFound('Key not found');
    return key;
  }

  @Get()
  @Auth('session')
  async list(@Req() req: FastifyRequest): Promise<{ keys: ApiKeyResponse[] }> {
    const projectId = await this.scope(req);
    const rows = await this.prisma.apiKey.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return { keys: rows.map((r) => toResponse(r)) };
  }

  @Post()
  @Auth('session')
  @MinRole('admin')
  @HttpCode(201)
  async create(@Req() req: FastifyRequest, @Body() body: unknown): Promise<ApiKeyResponse> {
    const projectId = await this.scope(req);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    if (parsed.data.type === 'secret' && parsed.data.allowedOrigins?.length) {
      throw ApiError.badRequest('Secret keys do not use allowed origins');
    }
    if ((await this.prisma.apiKey.count({ where: { projectId, revokedAt: null } })) >= MAX_KEYS) {
      throw new ApiError(409, 'limit_reached', `At most ${MAX_KEYS} active keys per project`);
    }
    const generated = generateKey(parsed.data.type);
    const row = await this.prisma.apiKey.create({
      data: {
        projectId,
        type: parsed.data.type,
        name: parsed.data.name ?? null,
        prefix: generated.prefix,
        hash: generated.hash,
        allowedOrigins: parsed.data.allowedOrigins ?? [],
      },
    });
    return toResponse(row, generated.key);
  }

  @Patch(':keyId')
  @Auth('session')
  @MinRole('admin')
  async update(@Req() req: FastifyRequest, @Param('keyId') keyId: string, @Body() body: unknown): Promise<ApiKeyResponse> {
    const projectId = await this.scope(req);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw invalidFields(parsed.error);
    const key = await this.find(projectId, keyId);
    if (key.revokedAt) throw new ApiError(409, 'key_revoked', 'Key is revoked');
    if (key.type === 'secret' && parsed.data.allowedOrigins !== undefined) {
      throw ApiError.badRequest('Secret keys do not use allowed origins');
    }
    const row = await this.prisma.apiKey.update({ where: { id: key.id }, data: parsed.data });
    this.keys.evict(row.prefix);
    return toResponse(row);
  }

  @Post(':keyId/revoke')
  @Auth('session')
  @MinRole('admin')
  async revoke(@Req() req: FastifyRequest, @Param('keyId') keyId: string): Promise<ApiKeyResponse> {
    const projectId = await this.scope(req);
    const key = await this.find(projectId, keyId);
    const row = key.revokedAt ? key : await this.prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    this.keys.evict(row.prefix);
    return toResponse(row);
  }
}
