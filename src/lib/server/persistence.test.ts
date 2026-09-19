/**
 * Persistence tests. These run against a REAL PostgreSQL database when
 * DATABASE_URL is set (CI provides a Postgres service; locally `npm run db:migrate`
 * against a dev database). Without DATABASE_URL they are skipped honestly —
 * the suite still passes but reports skipped persistence coverage.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../db";
import type { ResearchRun } from "../research-types";
import type { Opportunity } from "../types";

const hasDb = Boolean(process.env.DATABASE_URL);

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeOpportunityData(id: string): Opportunity {
  return {
    id,
    title: `Persistence test opportunity ${uniqueSuffix()}`,
    category: "SAAS",
    businessModel: "SAAS",
    targetAudience: "Test audience",
    problemSolved: "Test problem",
    monetizationMethod: "Test monetization",
    estimatedStartupCost: 100,
    demandScore: 60,
    competitionScore: 40,
    commercialIntentScore: 55,
    automationScore: 50,
    differentiationScore: 45,
    monetizationStrengthScore: 50,
    halalScore: 80,
    halalStatus: "HALAL",
    overallScore: 55,
    confidence: 40,
    status: "IDEA",
    evidence: [],
    risks: [],
    nextAction: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeResearchRun(runId: string, opportunityId: string): ResearchRun {
  return {
    id: runId,
    opportunityId,
    status: "PARTIAL",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    queries: [
      { query: `${opportunityId} demand market`, source: "brave", purpose: "demand" },
      { query: `${opportunityId} pain`, source: "reddit", purpose: "pain-point" },
    ],
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
      {
        id: `${runId}-ev-2`,
        source: "reddit",
        title: "Pain point evidence B",
        url: "https://example.com/b",
        snippet: "Snippet B",
        collectedAt: new Date().toISOString(),
        relevanceScore: 0.75,
        qualityScore: 0.65,
        hash: `${runId}-hash-b`,
        supports: ["pain-point"],
        contradicts: ["demand narrative differs"],
        dataClass: "REAL_LIVE_DATA",
      },
    ],
    findings: [
      {
        id: `${runId}-f-1`,
        claim: "Demand evidence collected",
        summary: "A; B",
        confidence: 0.7,
        evidenceIds: [`${runId}-ev-1`, `${runId}-ev-2`],
        contradictions: [],
      },
    ],
    validationSignals: [
      { key: "demand", label: "Demand", status: "MIXED", evidenceIds: [`${runId}-ev-1`], basis: "1 item" },
      { key: "pain-point", label: "Pain Point", status: "MIXED", evidenceIds: [`${runId}-ev-2`], basis: "1 item" },
      { key: "commercial-intent", label: "Commercial Intent", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
      { key: "trend", label: "Trend", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
      { key: "competition", label: "Competition", status: "INSUFFICIENT", evidenceIds: [], basis: "0 items" },
    ],
    confidence: 0.62,
    conclusion: "REQUIRES_HUMAN_REVIEW",
    conclusionBasis: "Contradiction recorded; human review required.",
    providersAttempted: ["brave", "reddit"],
    providersSucceeded: ["brave", "reddit"],
    providerStatuses: [
      { name: "brave", status: "SUCCEEDED", evidenceCount: 1, error: null },
      { name: "reddit", status: "SUCCEEDED", evidenceCount: 1, error: null },
    ],
    errors: [],
    scoreIntegration: { suggestedOverallScore: null, factors: [] },
  };
}

describe.skipIf(!hasDb)("persistence (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdOpportunityIds: string[] = [];

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("opportunity CRUD round-trips through the database", async () => {
    const id = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(id);
    const { opportunityRepository } = await import("./repositories/opportunities");
    const created = await opportunityRepository.create({
      ...makeOpportunityData(id),
      id: undefined,
    } as never);
    createdOpportunityIds.push(created.id);
    expect(created.id).not.toBe(id); // server assigns id
    const loaded = await opportunityRepository.getById(created.id);
    expect(loaded?.title).toBe(created.title);
    const updated = await opportunityRepository.update(created.id, { confidence: 77 });
    expect(updated?.confidence).toBe(77);
    expect(await opportunityRepository.delete(created.id)).toBe(true);
  });

  it("research run persists sources, evidence, findings, validation transactionally", async () => {
    const { researchRepository } = await import("./repositories/research");
    const oppId = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    const prisma = getPrisma();
    await prisma.opportunity.create({ data: { ...makeOpportunityData(oppId), id: oppId } as never });

    const run = makeResearchRun(`research-test-${uniqueSuffix()}`, oppId);
    const saved = await researchRepository.save(run);

    expect(saved.evidence).toHaveLength(2);
    expect(saved.findings).toHaveLength(1);

    const validation = await researchRepository.getValidationByRunId(run.id);
    expect(validation).not.toBeNull();
    expect(validation?.conclusion).toBe("REQUIRES_HUMAN_REVIEW");
    expect(validation?.sourceDiversity).toBe(2);
    expect(validation?.evidenceCoverage).toBe(2);
    expect(validation?.signals.find((s) => s.key === "demand")?.status).toBe("MIXED");

    const sources = await prisma.researchSource.findMany({ where: { researchRunId: run.id } });
    expect(sources).toHaveLength(2);
    const braveSource = sources.find((s) => s.provider === "brave");
    expect(braveSource?.status).toBe("SUCCEEDED");

    const linkedEvidence = await prisma.evidence.findMany({
      where: { researchRunId: run.id },
      include: { researchSource: true },
    });
    for (const item of linkedEvidence) {
      expect(item.researchSourceId).not.toBeNull();
      expect(item.researchSource?.provider).toBe(item.source);
    }

    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } });
    expect(opportunity.lastResearchRunId).toBe(run.id);
    expect(opportunity.lastResearchConclusion).toBe("REQUIRES_HUMAN_REVIEW");
    expect(opportunity.researchRunCount).toBe(1);
  });

  it("duplicate evidence per run is rejected by the unique constraint", async () => {
    const { researchRepository } = await import("./repositories/research");
    const oppId = `test-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    const prisma = getPrisma();
    await prisma.opportunity.create({ data: { ...makeOpportunityData(oppId), id: oppId } as never });
    const run = makeResearchRun(`research-dup-${uniqueSuffix()}`, oppId);
    // Simulate duplicate content: same hash twice for one run.
    run.evidence = [...run.evidence, { ...run.evidence[0]!, id: `${run.id}-ev-dup` }];
    await expect(researchRepository.save(run)).rejects.toThrow();
  });

  it("deleting an opportunity cascades to its research runs", async () => {
    const { researchRepository } = await import("./repositories/research");
    const oppId = `test-opp-${uniqueSuffix()}`;
    const prisma = getPrisma();
    await prisma.opportunity.create({ data: { ...makeOpportunityData(oppId), id: oppId } as never });
    const run = makeResearchRun(`research-cascade-${uniqueSuffix()}`, oppId);
    await researchRepository.save(run);
    await prisma.opportunity.delete({ where: { id: oppId } });
    expect(await prisma.researchRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await prisma.evidence.findFirst({ where: { researchRunId: run.id } })).toBeNull();
    expect(await prisma.validation.findUnique({ where: { researchRunId: run.id } })).toBeNull();
  });

  it("experiment/product/revenue/agent/agent-run persistence works", async () => {
    const oppId = `test-opp-${uniqueSuffix()}`;
    const prisma = getPrisma();
    await prisma.opportunity.create({ data: { ...makeOpportunityData(oppId), id: oppId } as never });
    createdOpportunityIds.push(oppId);

    const product = await prisma.product.create({
      data: {
        name: "Persist test product",
        type: "DIGITAL_TOOL",
        opportunityId: oppId,
        status: "PLANNED",
        price: 10,
        cost: 1,
        revenue: 0,
        isSample: false,
      },
    });
    const experiment = await prisma.experiment.create({
      data: {
        hypothesis: "Persist test hypothesis",
        opportunityId: oppId,
        target: "10 sales",
        budget: 0,
        startDate: new Date(),
        status: "PLANNED",
        revenue: 0,
        profit: 0,
        conversionRate: 0,
        isSample: false,
      },
    });
    const revenue = await prisma.revenueEntry.create({
      data: {
        date: new Date(),
        productId: product.id,
        opportunityId: oppId,
        revenueSource: "PRODUCT_SALES",
        grossRevenue: "19.99",
        fees: "2.00",
        advertisingCost: "0",
        otherCosts: "0",
        netRevenue: "17.99",
        isSample: false,
      },
    });
    expect(revenue.grossRevenue.toNumber()).toBeCloseTo(19.99, 2);

    const agent = await prisma.agent.create({
      data: {
        name: `Persist test agent ${uniqueSuffix()}`,
        type: "RESEARCH",
        description: "",
        status: "IDLE",
        isSample: false,
      },
    });
    const { agentRunRepository } = await import("./repositories/agent-runs");
    const agentRun = await agentRunRepository.create({
      agentId: agent.id,
      task: "collect demand evidence",
      input: { query: "test" },
    });
    expect(agentRun.status).toBe("RUNNING");
    const completed = await agentRunRepository.complete(agentRun.id, { ok: true });
    expect(completed?.status).toBe("COMPLETED");
    const runs = await agentRunRepository.getByAgentId(agent.id);
    expect(runs).toHaveLength(1);

    // Cleanup this test's own records.
    await prisma.agentRun.deleteMany({ where: { agentId: agent.id } });
    await prisma.agent.delete({ where: { id: agent.id } });
    await prisma.revenueEntry.delete({ where: { id: revenue.id } });
    await prisma.experiment.delete({ where: { id: experiment.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });
});
