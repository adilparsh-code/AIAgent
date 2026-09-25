-- HIGH-4: enforce one experiment per handoff.
--
-- A handoff is accepted once and produces exactly one experiment. Previously
-- Experiment.handoffId was only indexed, so two concurrent "createExperiment"
-- requests could both observe an ACCEPTED handoff and both create an
-- experiment for it.
--
-- Additive and non-destructive:
--   1. Any pre-existing duplicate experiments are DETACHED (handoffId set to
--      NULL) rather than deleted, so no experiment data is lost. The earliest
--      experiment for each handoff keeps the link.
--   2. A unique index is then created. NULLs are still allowed to repeat, so
--      experiments that were never created from a handoff are unaffected.
UPDATE "Experiment"
SET "handoffId" = NULL
WHERE "handoffId" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "handoffId" ORDER BY "createdAt" ASC, "id" ASC) AS rank
      FROM "Experiment"
      WHERE "handoffId" IS NOT NULL
    ) ranked
    WHERE ranked.rank = 1
  );

CREATE UNIQUE INDEX "Experiment_handoffId_key" ON "Experiment"("handoffId");
