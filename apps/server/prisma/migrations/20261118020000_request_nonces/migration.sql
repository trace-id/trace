-- CreateTable
CREATE TABLE "request_nonces" (
    "projectId" UUID NOT NULL,
    "nonce" CHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_nonces_pkey" PRIMARY KEY ("projectId","nonce")
);

-- CreateIndex
CREATE INDEX "request_nonces_createdAt_idx" ON "request_nonces"("createdAt");

-- AddForeignKey
ALTER TABLE "request_nonces" ADD CONSTRAINT "request_nonces_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
