-- CreateTable
CREATE TABLE "instance_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" VARCHAR(64),

    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ip_providers" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "sharePercent" INTEGER NOT NULL DEFAULT 100,
    "dailyLimit" INTEGER,
    "strategy" VARCHAR(12) NOT NULL DEFAULT 'weighted',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ip_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_provider_keys" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "sealed" TEXT NOT NULL,
    "hint" VARCHAR(40) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "dailyLimit" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_provider_usage" (
    "day" DATE NOT NULL,
    "providerRef" VARCHAR(64) NOT NULL,
    "keyRef" VARCHAR(64) NOT NULL DEFAULT '',
    "provider" VARCHAR(40) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" INTEGER NOT NULL DEFAULT 0,
    "authFailed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ip_provider_usage_pkey" PRIMARY KEY ("day","providerRef","keyRef")
);

-- CreateIndex
CREATE INDEX "ip_providers_priority_idx" ON "ip_providers"("priority");

-- CreateIndex
CREATE INDEX "ip_provider_keys_providerId_idx" ON "ip_provider_keys"("providerId");

-- CreateIndex
CREATE INDEX "ip_provider_usage_day_idx" ON "ip_provider_usage"("day");

-- AddForeignKey
ALTER TABLE "ip_provider_keys" ADD CONSTRAINT "ip_provider_keys_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ip_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

