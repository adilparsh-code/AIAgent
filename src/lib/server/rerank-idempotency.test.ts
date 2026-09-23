/**
 * Phase 6C — rerank idempotency/determinism regression (real PostgreSQL).
 *
 * Guards the invariant that `overallScore` is the immutable research base and
 * the bounded experiment delta is stored separately, so repeated reranks are
 * idempotent (no compounding) and order-independent (same inputs → same
 * effective scores, since scores are computed from stored state, not run order).
 *
 * Self-contained fixtures; skipped without DATABASE_URL.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const suffix = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cookieJar = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

async function makeSufficientPositiveOpportunity(ownerId: string) {
  const prisma = getPrisma();
  const opportunityId = `${suffix}-opp`;
  await prisma.opportunity.create({
    data: {
      id: opportunityId,
      title: `Idempotency probe ${suffix}`,
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
      ownerId,
      lastResearchConclusion: "PROMISING",
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      hypothesis: "Probe hypothesis",
      opportunityId,
      target: "Measure conversions",
      budget: 300,
      startDate: new Date(),
      status: "RUNNING",
      isSample: false,
      revenue: 0,
      profit: 0,
      conversionRate: 0,
    },
  });
  await prisma.experimentMetric.createMany({
    data: [
      { experimentId: experiment.id, recordedAt: new Date("2026-09-01"), periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-01"), conversions: 2, revenue: 60, cost: 30, impressions: 1200, clicks: 40, source: "probe" },
      { experimentId: experiment.id, recordedAt: new Date("2026-09-02"), periodStart: new Date("2026-09-02"), periodEnd: new Date("2026-09-02"), conversions: 3, revenue: 90, cost: 30, impressions: 1400, clicks: 50, source: "probe" },
      { experimentId: experiment.id, recordedAt: new Date("2026-09-03"), periodStart: new Date("2026-09-03"), periodEnd: new Date("2026-09-03"), conversions: 0, revenue: 40, cost: 30, impressions: 1300, clicks: 45, source: "probe" },
    ],
  });
  return { opportunityId, experimentId: experiment.id };
}

describe.skipIf(!hasDb)("rerank idempotency + determinism (real PostgreSQL)", () => {
  const prisma = getPrisma();
  let userId = "";
  let opportunityId = "";

  afterAll(async () => {
    if (opportunityId) await prisma.opportunity.delete({ where: { id: opportunityId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("repeated reranks are idempotent and preserve the research base", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${suffix}@example.com`,
        name: "Rerank Probe",
        passwordHash: "probe-not-a-real-hash",
        role: "USER",
        status: "ACTIVE",
      },
    });
    userId = user.id;
    const created = await makeSufficientPositiveOpportunity(userId);
    opportunityId = created.opportunityId;

    const { rerankOpportunities } = await import("./learning-service");
    const r1 = await rerankOpportunities(userId);
    const e1 = r1.ranked.find((r) => r.opportunityId === opportunityId)!;
    expect(e1).toBeTruthy();
    expect(e1.experimentDelta).toBeGreaterThan(0);
    expect(e1.experimentDelta).toBeLessThanOrEqual(10); // bounded influence cap

    const storedAfterRun1 = await prisma.opportunity.findUniqueOrThrow({
      where: { id: opportunityId },
      select: { overallScore: true, experimentScoreDelta: true },
    });
    expect(Number(storedAfterRun1.overallScore)).toBe(60); // research base untouched
    expect(Number(storedAfterRun1.experimentScoreDelta)).toBe(e1.experimentDelta);

    const r2 = await rerankOpportunities(userId);
    const e2 = r2.ranked.find((r) => r.opportunityId === opportunityId)!;
    // Idempotent: same evidence → same effective score, no compounding.
    expect(e2.newScore).toBe(e1.newScore);
    // Effective score = research base + bounded delta.
    expect(e2.newScore).toBe(60 + e2.experimentDelta);
    // The previously applied delta is replaced, not added again.
    expect(e2.previousScore).toBe(e1.newScore);
  });
});
