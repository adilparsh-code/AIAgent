/**
 * Phase 5 persistence tests. Run against real PostgreSQL when DATABASE_URL is
 * set (CI provides Postgres 16); skipped honestly otherwise.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeOpportunityData(id: string) {
  return {
    id,
    title: `Handoff persistence test ${uniqueSuffix()}`,
    category: "SAAS" as const,
    businessModel: "SAAS" as const,
    targetAudience: "Test audience",
    problemSolved: "Test problem",
    monetizationMethod: "Subscription",
    estimatedStartupCost: 100,
    demandScore: 60,
    competitionScore: 40,
    commercialIntentScore: 55,
    automationScore: 50,
    differentiationScore: 45,
    monetizationStrengthScore: 50,
    halalScore: 80,
    halalStatus: "HALAL" as const,
    overallScore: 62.5,
    confidence: 40,
    status: "VALIDATED" as const,
    evidence: [],
    risks: ["Platform dependency"],
    nextAction: "Build landing page",
    isSample: false,
  };
}

describe.skipIf(!hasDb)("handoff persistence (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdOpportunityIds: string[] = [];

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("handoff lifecycle persists and transitions DRAFT → HANDOFF_READY → ACCEPTED → COMPLETED", async () => {
    const oppId = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    await prisma.opportunity.create({ data: makeOpportunityData(oppId) });

    const { createHandoff, decideHandoff, createExperimentFromHandoff } = await import("./handoff-service");
    const { researchRepository } = await import("./repositories/research");

    // Seed a completed research run so the opportunity passes the evidence gate.
    const runId = `research-${uniqueSuffix()}`;
    await researchRepository.save({
      id: runId,
      opportunityId: oppId,
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      queries: [{ query: `${oppId} demand`, source: "brave", purpose: "demand" }],
      evidence: [
        {
          id: `${runId}-ev-1`,
          source: "brave",
          title: "Demand evidence A",
          url: "https://example.com/a",
          snippet: "Snippet A",
          collectedAt: new Date().toISOString(),
          relevanceScore: 0.8,
          qualityScore: 0.7,
          hash: `${runId}-hash-a`,
          supports: ["demand"],
          contradicts: [],
          dataClass: "REAL_LIVE_DATA",
        },
      ],
      findings: [],
      validationSignals: [
        { key: "demand", label: "Demand", status: "MIXED", evidenceIds: [`${runId}-ev-1`], basis: "1 item" },
        { key: "pain-point", label: "Pain Point", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "commercial-intent", label: "Commercial Intent", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "trend", label: "Trend", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
        { key: "competition", label: "Competition", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
      ],
      confidence: 0.75,
      conclusion: "VALIDATED",
      conclusionBasis: "Test basis",
      providersAttempted: ["brave"],
      providersSucceeded: ["brave"],
      providerStatuses: [{ name: "brave", status: "SUCCEEDED", evidenceCount: 1, error: null }],
      errors: [],
      scoreIntegration: { suggestedOverallScore: null, factors: [] },
    });

    // 1. Create — must pass the evidence gate.
    const created = await createHandoff({ opportunityId: oppId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const handoffId = created.handoff.id;
    expect(created.handoff.status).toBe("HANDOFF_READY");
    expect(created.handoff.contract.opportunityId).toBe(oppId);
    expect(created.handoff.contract.experimentHypothesis).toBeTruthy();
    expect(created.handoff.confidence).toBeCloseTo(0.75, 2);

    // 2. Accept.
    const accepted = await decideHandoff(handoffId, "accept");
    expect(accepted?.status).toBe("ACCEPTED");
    expect(accepted?.acceptedAt).toBeTruthy();

    // 3. Create experiment from the accepted handoff (transactional).
    const experiment = await createExperimentFromHandoff(handoffId, { budget: 250 });
    expect(experiment).not.toBeNull();
    expect(experiment?.status).toBe("READY");
    expect(experiment?.budget).toBe(250);
    expect(experiment?.handoffId).toBe(handoffId);
    expect(experiment?.hypothesis).toBe(created.handoff.experimentHypothesis);

    // The handoff is marked COMPLETED by the same transaction.
    const completed = await prisma.handoff.findUniqueOrThrow({ where: { id: handoffId } });
    expect(completed.status).toBe("COMPLETED");

    // 4. Re-deciding a COMPLETED handoff is rejected.
    await expect(decideHandoff(handoffId, "accept")).rejects.toThrow("cannot be re-decided");

    // Cleanup.
    await prisma.experiment.delete({ where: { id: experiment!.id } });
  });

  it("an opportunity without a research run is not handoff-eligible", async () => {
    const oppId = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    await prisma.opportunity.create({ data: makeOpportunityData(oppId) });

    const { createHandoff } = await import("./handoff-service");
    const result = await createHandoff({ opportunityId: oppId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toContain("NO_RESEARCH_RUN");
    expect(result.reasons).toContain("NO_EVIDENCE");
  });
});
