-- CreateTable for generic managed scheduling setup
CREATE TABLE IF NOT EXISTS "ManagedSchedulingSetup" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Not Started',
    "zoomUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedSchedulingSetup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedSchedulingSetup_userId_provider_key" ON "ManagedSchedulingSetup"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedSchedulingSetup_provider_externalId_key" ON "ManagedSchedulingSetup"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "ManagedSchedulingSetup" ADD CONSTRAINT "ManagedSchedulingSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing ZohoSchedulingSetup data to ManagedSchedulingSetup
INSERT INTO "ManagedSchedulingSetup" ("userId", "provider", "externalId", "status", "zoomUserId", "createdAt", "updatedAt")
SELECT
    "userId",
    'zoho' as "provider",
    "zuid" as "externalId",
    "status",
    "zoomUserId",
    "createdAt",
    "updatedAt"
FROM "ZohoSchedulingSetup"
WHERE "userId" IS NOT NULL
ON CONFLICT DO NOTHING;