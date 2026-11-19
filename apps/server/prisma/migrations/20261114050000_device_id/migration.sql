-- AlterTable
ALTER TABLE "visitors" ADD COLUMN "deviceId" VARCHAR(32);

-- CreateIndex
CREATE INDEX "visitors_projectId_deviceId_idx" ON "visitors"("projectId", "deviceId");
