-- CreateTable
CREATE TABLE "event_labels" (
    "projectId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "fraud" BOOLEAN NOT NULL,
    "visitorId" VARCHAR(32) NOT NULL,
    "detected" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_labels_pkey" PRIMARY KEY ("projectId","eventId","label")
);

-- CreateTable
CREATE TABLE "fraud_models" (
    "projectId" UUID NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "model" JSONB NOT NULL,
    "trainedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fraud_models_pkey" PRIMARY KEY ("projectId","label")
);

-- CreateIndex
CREATE INDEX "event_labels_projectId_label_updatedAt_idx" ON "event_labels"("projectId", "label", "updatedAt");

-- CreateIndex
CREATE INDEX "event_labels_visitorId_idx" ON "event_labels"("visitorId");

-- AddForeignKey
ALTER TABLE "event_labels" ADD CONSTRAINT "event_labels_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_models" ADD CONSTRAINT "fraud_models_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
