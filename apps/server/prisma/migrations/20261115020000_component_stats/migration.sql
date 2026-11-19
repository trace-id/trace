-- CreateTable
CREATE TABLE "component_stats" (
    "projectId" UUID NOT NULL,
    "component" VARCHAR(24) NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "visitors" INTEGER NOT NULL,

    CONSTRAINT "component_stats_pkey" PRIMARY KEY ("projectId","component","value")
);

-- AddForeignKey
ALTER TABLE "component_stats" ADD CONSTRAINT "component_stats_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
