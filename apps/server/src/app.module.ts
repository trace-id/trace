import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { type ScoringConfig } from '@trace-id/signals/config';
import { AUTH, createAuth } from './auth/auth.js';
import { AccountsService } from './accounts/accounts.service.js';
import { DevicesController } from './accounts/devices.controller.js';
import { AuthGuard } from './common/auth.js';
import { ErrorFilter } from './common/error.filter.js';
import { ENV, type Env } from './config/env.js';
import { SCORING } from './config/scoring.js';
import { EventsController } from './events/events.controller.js';
import { FraudController } from './fraud/fraud.controller.js';
import { IpIntelController } from './intel/ip-intel.controller.js';
import { IpProvidersService } from './intel/ip-providers.service.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { ListsController } from './lists/lists.controller.js';
import { ListsService } from './lists/lists.service.js';
import { MembersController } from './manage/members.controller.js';
import { InstanceController } from './settings/instance.controller.js';
import { InstanceSettingsService } from './settings/instance-settings.service.js';
import { FraudService } from './fraud/fraud.service.js';
import { HealthController } from './health/health.controller.js';
import { IdentifyController } from './identify/identify.controller.js';
import { CrossBrowserService } from './crossbrowser/crossbrowser.service.js';
import { IdentifyService } from './identify/identify.service.js';
import { MaintenanceService } from './infra/maintenance.service.js';
import { PrismaService } from './infra/prisma.service.js';
import { RateLimitService } from './infra/rate-limit.service.js';
import { RedisService } from './infra/redis.service.js';
import { IP_INTEL, type IpIntelProvider } from './intel/ip-intel.js';
import { TlsIntelService } from './intel/tls-intel.js';
import { KeyService } from './keys/key.service.js';
import { OpenApiController } from './openapi/openapi.controller.js';
import { SdkController } from './sdk/sdk.controller.js';
import { ManageController } from './manage/manage.controller.js';
import { InvestigateService } from './manage/investigate.service.js';
import { AnalyticsService } from './manage/analytics.service.js';
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
        DevicesController,
        WebhooksController,
        ManageController,
        ProjectKeysController,
        ProjectDataController,
        FraudController,
        IpIntelController,
        MembersController,
        ListsController,
        AlertsController,
        InstanceController,
        HealthController,
        SdkController,
        OpenApiController,
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
        AnalyticsService,
        InvestigateService,
        WebhookAdminService,
        RedisService,
        RateLimitService,
        KeyService,
        VelocityService,
        IdentifyService,
        CrossBrowserService,
        AccountsService,
        TlsIntelService,
        MaintenanceService,
        WebhookService,
        WebhookWorkerService,
        FraudService,
        InstanceSettingsService,
        ListsService,
        AlertsService,
        IpProvidersService,
      ],
    };
  }
}
