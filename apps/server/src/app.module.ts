import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { type ScoringConfig } from '@tbdname/signals/config';
import { AUTH, createAuth } from './auth/auth.js';
import { AuthGuard } from './common/auth.js';
import { ErrorFilter } from './common/error.filter.js';
import { ENV, type Env } from './config/env.js';
import { SCORING } from './config/scoring.js';
import { EventsController } from './events/events.controller.js';
import { HealthController } from './health/health.controller.js';
import { IdentifyController } from './identify/identify.controller.js';
import { IdentifyService } from './identify/identify.service.js';
import { MaintenanceService } from './infra/maintenance.service.js';
import { PrismaService } from './infra/prisma.service.js';
import { RateLimitService } from './infra/rate-limit.service.js';
import { RedisService } from './infra/redis.service.js';
import { IP_INTEL, type IpIntelProvider } from './intel/ip-intel.js';
import { KeyService } from './keys/key.service.js';
import { ManageController } from './manage/manage.controller.js';
import { ProjectDataController } from './manage/project-data.controller.js';
import { ProjectKeysController } from './manage/project-keys.controller.js';
import { VelocityService } from './velocity/velocity.service.js';
import { VisitorsController } from './visitors/visitors.controller.js';
import { VisitorsService } from './visitors/visitors.service.js';
import { WebhookAdminService } from './webhooks/webhook-admin.service.js';
import { WebhookWorkerService } from './webhooks/webhook-worker.service.js';
import { WebhookService } from './webhooks/webhook.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';

export interface AppDependencies {
  env: Env;
  scoring: ScoringConfig;
  ipIntel: IpIntelProvider;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        IdentifyController,
        EventsController,
        VisitorsController,
        WebhooksController,
        ManageController,
        ProjectKeysController,
        ProjectDataController,
        HealthController,
      ],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: SCORING, useValue: deps.scoring },
        { provide: IP_INTEL, useValue: deps.ipIntel },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        PrismaService,
        { provide: AUTH, useFactory: (env: Env, prisma: PrismaService) => createAuth(env, prisma), inject: [ENV, PrismaService] },
        VisitorsService,
        WebhookAdminService,
        RedisService,
        RateLimitService,
        KeyService,
        VelocityService,
        IdentifyService,
        MaintenanceService,
        WebhookService,
        WebhookWorkerService,
      ],
    };
  }
}
