-- Extend User with username/password auth plus basics-only profile fields.
-- Email becomes optional (filled in later via the profile UI).

-- New nullable profile columns.
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;
ALTER TABLE "User" ADD COLUMN "weightKg" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;

-- Auth columns land nullable so the existing pre-auth dev row survives the ADD.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- Backfill the pre-auth dev row with an unusable placeholder hash (64-hex
-- salt, 128-hex key, random bytes nobody knows). verifyPassword rejects any
-- login against it; the seed script (npm run db:seed) reassigns the dev
-- row's data to Wictor and deletes it, so this value only satisfies NOT NULL.
UPDATE "User" SET "username" = 'dev', "passwordHash" = 'd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33f:e8f4c1a7b2d94f6c8a3e5d7b1c9a4f6e2d8b0a3c5e7f9a1b4d6c8e0a2f4b6d8c9e1a3f5b7d9c0e2f4a6b8d0c2e4f6a8b0d2c4e6f8a0b1d3e5f7a9c0e2b4d6f8a0c1e3f5a7b9', "displayName" = 'Dev' WHERE "username" IS NULL;

-- Enforce required + unique.
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Email becomes optional.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
