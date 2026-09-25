/**
 * HIGH-4 regression suite: one handoff produces at most one experiment.
 *
 * The bug this locks down: `createExperimentFromHandoff` read the handoff
 * outside its transaction and then unconditionally created the experiment and
 * flipped the handoff to COMPLETED, so two concurrent requests could both
 * create an experiment for the same handoff. `Experiment.handoffId` was only
 * indexed, so nothing at the storage level prevented it either.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!hasDb)("HIGH-4 one experiment per handoff (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUsers: string[] = [];
  const createdOpportunities: string[] = [];
  const createdHandoffs: string[] = [];

  afterAll(async () => {
    for (const id of createdHandoffs) await prisma.handoff.delete({ where: { id } }).catch(() => undefined);
    for (const id of createdOpportunities) await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    for (const id of createdUsers) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function seedAcceptedHandoff(tag: string) {
    const user = await prisma.user.create({
      data: {
        email: `handoff4-${tag}-${suffix}@example.com`.toLowerCase(),
        name: `Handoff 4 ${tag}`,
        passwordHash: "not-a-real-hash",
        role: "USER",
        status: "ACTIVE",
      },
    });
    createdUsers.push(user.id);

    const opportunity = await prisma.opportunity.create({
      data: {
        title: `Handoff 4 opp ${tag} ${suffix}`,
        category: "SAAS",
        businessModel: "SAAS",
        estimatedStartupCost: 100,
        demandScore: 60,
        competitionScore: 40,
        commercialIntentScore: 55,
        automationScore: 50,
        differentiationScore: 45,
        monetizationStrengthScore: 50,
        halalScore: 80,
        halalStatus: "HALAL",
        overallScore: 60,
        confidence: 40,
        status: "VALIDATED",
        risks: ["Platform dependency"],
        isSample: false,
        ownerId: user.id,
      },
    });
    createdOpportunities.push(opportunity.id);

    const handoff = await prisma.handoff.create({
      data: {
        opportunityId: opportunity.id,
        contractVersion: 1,
        contract: { contractVersion: 1, title: "Handoff 4 contract" },
        status: "ACCEPTED",
        validationConclusion: "VALIDATED",
        confidence: 0.8,
        score: 70,
        experimentHypothesis: "Test the MVP with a landing page",
        successCriteria: ["Record a measurable outcome"],
        acceptedAt: new Date(),
      },
    });
    createdHandoffs.push(handoff.id);

    return { user, opportunity, handoff };
  }

  it("creates exactly one experiment when the same handoff is executed twice in a row", async () => {
    const { user, handoff } = await seedAcceptedHandoff("sequential");
    const { createExperimentFromHandoff } = await import("@/lib/server/handoff-service");

    const first = await createExperimentFromHandoff(handoff.id, undefined, user.id);
    expect(first).not.toBeNull();

    // A second call is an idempotent replay: same experiment, no new row.
    const second = await createExperimentFromHandoff(handoff.id, undefined, user.id);
    expect(second?.id).toBe(first!.id);

    const experiments = await prisma.experiment.findMany({ where: { handoffId: handoff.id } });
    expect(experiments).toHaveLength(1);
    expect(experiments[0]!.status).toBe("READY");
  });

  it("concurrent createExperiment calls produce exactly one experiment", async () => {
    const { user, handoff } = await seedAcceptedHandoff("concurrent");
    const { createExperimentFromHandoff } = await import("@/lib/server/handoff-service");

    // Both requests race without awaiting in between.
    const results = await Promise.allSettled([
      createExperimentFromHandoff(handoff.id, undefined, user.id),
      createExperimentFromHandoff(handoff.id, undefined, user.id),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Whatever the interleaving, exactly one experiment row exists.
    const experiments = await prisma.experiment.findMany({ where: { handoffId: handoff.id } });
    expect(experiments).toHaveLength(1);

    // And the handoff is COMPLETED exactly once.
    const handoffRow = await prisma.handoff.findUniqueOrThrow({ where: { id: handoff.id } });
    expect(handoffRow.status).toBe("COMPLETED");

    // Any successful caller returns the same single experiment id.
    const ids = fulfilled.map((result) => (result as PromiseFulfilledResult<{ id: string }>).value?.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("enforces one experiment per handoff at the storage layer", async () => {
    const { user, handoff } = await seedAcceptedHandoff("unique");
    const { createExperimentFromHandoff } = await import("@/lib/server/handoff-service");
    await createExperimentFromHandoff(handoff.id, undefined, user.id);

    // Bypassing the service entirely must still fail: the unique index is the
    // second, non-bypassable guarantee.
    await expect(
      prisma.experiment.create({
        data: {
          hypothesis: "Duplicate attempt",
          opportunityId: (await prisma.handoff.findUniqueOrThrow({ where: { id: handoff.id } })).opportunityId,
          target: "Duplicate",
          budget: 0,
          startDate: new Date(),
          expectedResult: "",
          objective: "",
          successCriteria: [],
          status: "READY",
          handoffId: handoff.id,
          isSample: false,
          revenue: 0,
          profit: 0,
          conversionRate: 0,
        },
      }),
    ).rejects.toThrow();

    expect(await prisma.experiment.count({ where: { handoffId: handoff.id } })).toBe(1);
  });

  it("still allows many experiments that were never created from a handoff", async () => {
    const { user, opportunity } = await seedAcceptedHandoff("nohandoff");

    for (let index = 0; index < 2; index += 1) {
      await prisma.experiment.create({
        data: {
          hypothesis: `Direct experiment ${index}`,
          opportunityId: opportunity.id,
          target: "Manual experiment",
          budget: 0,
          startDate: new Date(),
          expectedResult: "",
          objective: "",
          successCriteria: [],
          status: "READY",
          handoffId: null,
          isSample: false,
          revenue: 0,
          profit: 0,
          conversionRate: 0,
        },
      });
    }

    // NULL handoffId values are not constrained by the unique index.
    expect(await prisma.experiment.count({ where: { opportunityId: opportunity.id, handoffId: null } })).toBe(2);
    expect(user.id).toBeTruthy();
  });
});
