-- CreateTable
CREATE TABLE "visitor_accounts" (
    "visitorId" VARCHAR(32) NOT NULL,
    "linkedId" VARCHAR(256) NOT NULL,
    "projectId" UUID NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visitor_accounts_pkey" PRIMARY KEY ("visitorId","linkedId")
);

-- CreateIndex
CREATE INDEX "visitor_accounts_projectId_linkedId_lastSeenAt_idx" ON "visitor_accounts"("projectId", "linkedId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "visitor_accounts" ADD CONSTRAINT "visitor_accounts_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
