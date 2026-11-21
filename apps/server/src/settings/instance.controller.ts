import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireUser } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { isInstanceAdmin } from '../intel/ip-providers.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { probeRedis, type RedisProbeResult, RedisService } from '../infra/redis.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { InstanceSettingsService, type SettingView } from './instance-settings.service.js';

/** Instance-wide settings, for the first account (the administrator). */
@Controller('v1/instance')
export class InstanceController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: InstanceSettingsService,
    private readonly redis: RedisService,
  ) {}

  private async limit(req: FastifyRequest): Promise<{ userId: string; admin: boolean }> {
    const { userId } = requireUser(req);
    await this.rateLimit.enforce([{ key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 }]);
    return { userId, admin: await isInstanceAdmin(this.prisma, userId) };
  }

  /** Whether the signed-in user administers the instance; the dashboard hides its instance pages otherwise. */
  @Get()
  @Auth('session')
  async info(@Req() req: FastifyRequest): Promise<{ admin: boolean }> {
    const { admin } = await this.limit(req);
    return { admin };
  }

  @Get('settings')
  @Auth('session')
  async list(@Req() req: FastifyRequest): Promise<{ settings: SettingView[] }> {
    const { admin } = await this.limit(req);
    if (!admin) throw ApiError.forbidden('instance_admin_required', 'Only the administrator (the first account) can change instance settings');
    return { settings: this.settings.list() };
  }

  /** Where Redis is connected and whether it is up. No credentials. */
  @Get('redis')
  @Auth('session')
  async redisStatus(@Req() req: FastifyRequest): Promise<{ status: string; target: string | null; source: 'dashboard' | 'environment' | 'none' }> {
    const { admin } = await this.limit(req);
    if (!admin) throw ApiError.forbidden('instance_admin_required', 'Only the administrator (the first account) can see this');
    const view = this.settings.list().find((s) => s.key === 'redis.url');
    return { status: this.redis.status, target: this.redis.target, source: view?.source === 'dashboard' ? 'dashboard' : this.redis.target ? 'environment' : 'none' };
  }

  /** Connects, pings and disconnects. With no body it tests the address now in use; with { url } it tests that one. */
  @Post('redis/test')
  @Auth('session')
  @HttpCode(200)
  async redisTest(@Req() req: FastifyRequest, @Body() body: unknown): Promise<RedisProbeResult> {
    const { admin } = await this.limit(req);
    if (!admin) throw ApiError.forbidden('instance_admin_required', 'Only the administrator (the first account) can run this');
    const given = typeof body === 'object' && body !== null && typeof (body as { url?: unknown }).url === 'string' ? (body as { url: string }).url.trim() : '';
    const url = given || this.settings.get<string | null>('redis.url');
    if (!url) throw ApiError.badRequest('No Redis address to test', 'invalid_request');
    if (!/^rediss?:\/\/\S+$/i.test(url)) throw ApiError.badRequest('The address must start with redis:// or rediss://', 'invalid_request');
    return probeRedis(url);
  }

  /** Body: { "<key>": value | null }. null returns the setting to the environment or built-in value. */
  @Patch('settings')
  @Auth('session')
  async update(@Req() req: FastifyRequest, @Body() body: unknown): Promise<{ settings: SettingView[] }> {
    const { userId, admin } = await this.limit(req);
    if (!admin) throw ApiError.forbidden('instance_admin_required', 'Only the administrator (the first account) can change instance settings');
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length === 0) throw ApiError.badRequest('Send an object of settings to change');
    await this.settings.update(body as Record<string, unknown>, userId);
    return { settings: this.settings.list() };
  }
}
