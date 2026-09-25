-- MEDIUM-11: three denormalized id columns carried no foreign key, so the
-- database could not stop them from pointing at rows that no longer exist.
--
--   Opportunity.lastResearchRunId     -> ResearchRun.id
--   Opportunity.lastRankingSnapshotId -> RankingSnapshot.id
--   DiscoveryCandidate.researchRunId  -> ResearchRun.id
--
-- These are "last seen" pointers on frequently read hot paths; they were
-- deliberately left unconstrained, which means a deleted run or snapshot left
-- a dangling id that the application could not distinguish from a live one.
--
-- Additive and non-destructive:
--   1. Any PRE-EXISTING dangling pointer is DETACHED (set to NULL) rather than
--      deleted. The opportunity and candidate rows themselves are untouched —
--      the denormalized cache pointer is rebuilt naturally on the next run.
--   2. The constraints are then added. NULLs are still permitted, so a
--      never-yet-researched opportunity is unaffected.
--
-- ON DELETE SET NULL matches the columns' role: they are a cache of "the most
-- recent related row", not a required relationship, so removing the related
-- row must not cascade-delete the opportunity that owns it.
UPDATE "Opportunity" o
SET "lastResearchRunId" = NULL
WHERE o."lastResearchRunId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ResearchRun" r WHERE r."id" = o."lastResearchRunId");

UPDATE "Opportunity" o
SET "lastRankingSnapshotId" = NULL
WHERE o."lastRankingSnapshotId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "RankingSnapshot" s WHERE s."id" = o."lastRankingSnapshotId");

UPDATE "DiscoveryCandidate" c
SET "researchRunId" = NULL
WHERE c."researchRunId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ResearchRun" r WHERE r."id" = c."researchRunId");

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_lastResearchRunId_fkey"
  FOREIGN KEY ("lastResearchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_lastRankingSnapshotId_fkey"
  FOREIGN KEY ("lastRankingSnapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscoveryCandidate"
  ADD CONSTRAINT "DiscoveryCandidate_researchRunId_fkey"
  FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
