-- CreateTable
CREATE TABLE "project_invites" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "project_role" NOT NULL,
    "invitedBy" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_entries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "value" VARCHAR(256) NOT NULL,
    "action" VARCHAR(5) NOT NULL,
    "note" VARCHAR(200),
    "createdBy" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMPTZ(3),

    CONSTRAINT "list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "minEvents" INTEGER NOT NULL DEFAULT 0,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrl" VARCHAR(2048),
    "webhookSecret" TEXT,
    "lastFiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ruleId" UUID,
    "ruleName" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "observed" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "delivery" VARCHAR(10) NOT NULL DEFAULT 'none',
    "deliveryError" VARCHAR(200),
    "firedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_invites_email_idx" ON "project_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "project_invites_projectId_email_key" ON "project_invites"("projectId", "email");

-- CreateIndex
CREATE INDEX "list_entries_projectId_action_idx" ON "list_entries"("projectId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "list_entries_projectId_kind_value_key" ON "list_entries"("projectId", "kind", "value");

-- CreateIndex
CREATE INDEX "alert_rules_projectId_idx" ON "alert_rules"("projectId");

-- CreateIndex
CREATE INDEX "alert_events_projectId_firedAt_idx" ON "alert_events"("projectId", "firedAt");

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

