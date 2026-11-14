-- CreateEnum
CREATE TYPE "api_key_type" AS ENUM ('public', 'secret');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "type" "api_key_type" NOT NULL,
    "name" VARCHAR(200),
    "prefix" VARCHAR(16) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" VARCHAR(32) NOT NULL,
    "projectId" UUID NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "signalSummary" JSONB NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_buckets" (
    "projectId" UUID NOT NULL,
    "bucketHash" CHAR(64) NOT NULL,
    "visitorId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_buckets_pkey" PRIMARY KEY ("projectId","bucketHash","visitorId")
);

-- CreateTable (range-partitioned by month; Prisma cannot express this, so it is hand-written)
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "visitorId" VARCHAR(32) NOT NULL,
    "matchKind" VARCHAR(16) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "suspectScore" SMALLINT NOT NULL,
    "reasons" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "ip" VARCHAR(64),
    "asn" INTEGER,
    "country" CHAR(2),
    "tags" JSONB,
    "linkedId" VARCHAR(256),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id","createdAt")
) PARTITION BY RANGE ("createdAt");

-- Catches rows if a monthly partition is ever missing, so ingest never fails on it.
CREATE TABLE "events_default" PARTITION OF "events" DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_projectId_idx" ON "api_keys"("projectId");

-- CreateIndex
CREATE INDEX "visitors_projectId_lastSeenAt_idx" ON "visitors"("projectId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "visitor_buckets_visitorId_idx" ON "visitor_buckets"("visitorId");

-- CreateIndex
CREATE INDEX "events_projectId_createdAt_idx" ON "events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "events_visitorId_createdAt_idx" ON "events"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "events_projectId_linkedId_createdAt_idx" ON "events"("projectId", "linkedId", "createdAt");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_buckets" ADD CONSTRAINT "visitor_buckets_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monthly partitions. The server calls this at startup and daily; the migration seeds the first ones.
CREATE OR REPLACE FUNCTION ensure_event_partitions(months_ahead integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  m date;
  part text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    m := (first_month + make_interval(months => i))::date;
    part := format('events_%s', to_char(m, 'YYYY_MM'));
    IF to_regclass(quote_ident(part)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF "events" FOR VALUES FROM (%L) TO (%L)',
        part,
        format('%s 00:00:00+00', m),
        format('%s 00:00:00+00', (m + interval '1 month')::date)
      );
    END IF;
  END LOOP;
END;
$$;

SELECT ensure_event_partitions(2);
