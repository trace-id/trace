-- CreateTable
CREATE TABLE "device_profiles" (
    "visitorId" VARCHAR(32) NOT NULL,
    "netHash" CHAR(32) NOT NULL,
    "projectId" UUID NOT NULL,
    "coreHash" CHAR(28),
    "browser" VARCHAR(16) NOT NULL,
    "profile" JSONB NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_profiles_pkey" PRIMARY KEY ("visitorId","netHash")
);

-- CreateIndex
CREATE INDEX "device_profiles_projectId_netHash_lastSeenAt_idx" ON "device_profiles"("projectId", "netHash", "lastSeenAt");

-- CreateIndex
CREATE INDEX "device_profiles_projectId_coreHash_idx" ON "device_profiles"("projectId", "coreHash");

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
