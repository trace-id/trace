import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { type DeviceResponse } from '@trace-id/signals/api';
import { type FastifyRequest } from 'fastify';
import { Auth, requireAuth } from '../common/auth.js';
import { ENV, type Env } from '../config/env.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { AccountsService } from './accounts.service.js';

/**
 * Attack surface: IDOR (queries scoped by the key's project; foreign and missing devices both 404), enumeration
 * (device ids are visitor ids: 119-bit random), DoS (per-key limit, bounded result sizes). Secret key only: the
 * response lists the customer's own account ids.
 */
@Controller('v1/devices')
export class DevicesController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly accounts: AccountsService,
  ) {}

  @Get(':deviceId')
  @Auth('secret')
  async device(@Req() req: FastifyRequest, @Param('deviceId') deviceId: string): Promise<DeviceResponse> {
    const key = requireAuth(req);
    await this.rateLimit.enforce([
      { key: `api:key:${key.keyId}`, limit: this.env.RATE_LIMIT_API_PER_KEY_PER_MIN, windowMs: 60_000 },
    ]);
    return this.accounts.device(key.projectId, deviceId);
  }
}
