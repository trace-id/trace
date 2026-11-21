import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { Auth, requireUser } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { type IpOverview, isInstanceAdmin, IpProvidersService, type ProviderView, type UsagePoint, type UsageTotals } from './ip-providers.service.js';

/**
 * IP data providers, their keys, usage and cache, for the dashboard. Instance-wide, so only the first account (the
 * administrator) may use it: the providers receive visitor IPs for every project on the server. Keys are accepted
 * here and never returned.
 */
@Controller('v1/ip-intel')
export class IpIntelController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly providers: IpProvidersService,
  ) {}

  private async admin(req: FastifyRequest): Promise<void> {
    const { userId } = requireUser(req);
    await this.rateLimit.enforce([{ key: `api:user:${userId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 }]);
    if (!(await isInstanceAdmin(this.prisma, userId))) throw ApiError.forbidden('instance_admin_required', 'Only the administrator (the first account) can manage IP providers');
  }

  @Get()
  @Auth('session')
  async overview(@Req() req: FastifyRequest): Promise<IpOverview> {
    await this.admin(req);
    return this.providers.overview();
  }

  @Get('usage')
  @Auth('session')
  async usage(@Req() req: FastifyRequest, @Query('days') days?: string): Promise<{ points: UsagePoint[]; byProvider: Record<string, UsageTotals>; byKey: Record<string, UsageTotals> }> {
    await this.admin(req);
    const n = Math.min(90, Math.max(1, Number.parseInt(days ?? '30', 10) || 30));
    return this.providers.usage(n);
  }

  @Post('providers')
  @Auth('session')
  @HttpCode(201)
  async createProvider(@Req() req: FastifyRequest, @Body() body: unknown): Promise<ProviderView> {
    await this.admin(req);
    return this.providers.createProvider(body);
  }

  @Patch('providers/:id')
  @Auth('session')
  async updateProvider(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown): Promise<ProviderView> {
    await this.admin(req);
    return this.providers.updateProvider(id, body);
  }

  @Delete('providers/:id')
  @Auth('session')
  @HttpCode(204)
  async deleteProvider(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
    await this.admin(req);
    await this.providers.deleteProvider(id);
  }

  @Post('providers/:id/keys')
  @Auth('session')
  @HttpCode(201)
  async addKey(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown): Promise<ProviderView> {
    await this.admin(req);
    return this.providers.addKey(id, body);
  }

  @Patch('providers/:id/keys/:keyId')
  @Auth('session')
  async updateKey(@Req() req: FastifyRequest, @Param('id') id: string, @Param('keyId') keyId: string, @Body() body: unknown): Promise<ProviderView> {
    await this.admin(req);
    return this.providers.updateKey(id, keyId, body);
  }

  @Delete('providers/:id/keys/:keyId')
  @Auth('session')
  async deleteKey(@Req() req: FastifyRequest, @Param('id') id: string, @Param('keyId') keyId: string): Promise<ProviderView> {
    await this.admin(req);
    return this.providers.deleteKey(id, keyId);
  }

  /** A real lookup to check credentials, for a saved provider/key or for values typed into the form. */
  @Post('test')
  @Auth('session')
  @HttpCode(200)
  async test(@Req() req: FastifyRequest, @Body() body: unknown): Promise<unknown> {
    await this.admin(req);
    return this.providers.test(body);
  }
}
