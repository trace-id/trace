import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENV, type Env } from '../config/env.js';
import { prismaOptions } from './prisma-client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(prismaOptions(env.DATABASE_URL, { statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS, poolMax: env.DB_POOL_MAX }));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
