import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { Auth } from '../common/auth.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Auth('none')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Redis is reported but does not fail readiness: the service degrades without it. */
  @Get('ready')
  @Auth('none')
  @HttpCode(200)
  async ready(): Promise<{ status: 'ok'; redis: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', redis: this.redis.available };
  }
}
