-- Enforce the cross-source dedup key: Postgres treats NULL as distinct in
-- unique indexes, so a nullable externalId would let (userId, source, NULL)
-- rows duplicate silently. All rows were backfilled in the previous migration.
ALTER TABLE "Activity" ALTER COLUMN "externalId" SET NOT NULL;
