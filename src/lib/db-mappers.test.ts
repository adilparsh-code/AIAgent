import { describe, expect, it } from "vitest";
import { mapAgent, mapExperiment, mapOpportunity, mapProduct, mapResearchRun, mapRevenue } from "./db-mappers";

describe("db mappers", () => {
  it("maps opportunity decimals and dates to numbers and ISO strings", () => {
    const mapped = mapOpportunity({
      id: "opp-real-1",
      title: "Real opportunity",
      category: "PRINTABLES",
      businessModel: "PRINTABLE",
      targetAudience: "Teachers",
      problemSolved: "Saves time",
      monetizationMethod: "Direct sales",
      estimatedStartupCost: { toNumber: () => 40.5 },
      demandScore: 80,
      competitionScore: 20,
      commercialIntentScore: 70,
      automationScore: 60,
      differentiationScore: 50,
      monetizationStrengthScore: 55,
      halalScore: 90,
      halalStatus: "HALAL",
      overallScore: { toNumber: () => 72.4 },
      confidence: 60,
      status: "IDEA",
      evidence: ["a"],
      risks: ["b"],
      nextAction: "Validate",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(mapped.estimatedStartupCost).toBe(40.5);
    expect(mapped.overallScore).toBe(72.4);
    expect(mapped.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mapped.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("maps money fields for products, experiments, and revenue", () => {
    const product = mapProduct({
      id: "prod-1",
      name: "Workbook",
      type: "WORKBOOK",
      targetAudience: "Kids",
      opportunityId: "opp-1",
      status: "PUBLISHED",
      price: { toNumber: () => 9.99 },
      cost: { toNumber: () => 1.5 },
      revenue: { toNumber: () => 20 },
      platform: "KDP",
      productUrl: null,
      affiliateUrl: null,
      metrics: { sales: 2 },
      notes: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(product.price).toBe(9.99);
    expect(product.metrics).toEqual({ sales: 2 });

    const experiment = mapExperiment({
      id: "exp-1",
      hypothesis: "It sells",
      opportunityId: "opp-1",
      target: "10 sales",
      budget: { toNumber: () => 25 },
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: null,
      expectedResult: "Profit",
      actualResult: null,
      visitors: 10,
      leads: 2,
      clicks: 5,
      sales: 1,
      revenue: { toNumber: () => 9.99 },
      profit: { toNumber: () => -15.01 },
      conversionRate: { toNumber: () => 10 },
      decision: null,
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(experiment.budget).toBe(25);
    expect(experiment.endDate).toBeNull();

    const revenue = mapRevenue({
      id: "rev-1",
      date: "2026-01-05T00:00:00.000Z",
      productId: "prod-1",
      opportunityId: "opp-1",
      revenueSource: "PRODUCT_SALES",
      grossRevenue: { toNumber: () => 100 },
      fees: { toNumber: () => 10 },
      advertisingCost: { toNumber: () => 5 },
      otherCosts: { toNumber: () => 1 },
      netRevenue: { toNumber: () => 84 },
      currency: "USD",
      referenceNote: "Order 1",
    });
    expect(revenue.netRevenue).toBe(84);

    const agent = mapAgent({
      id: "agent-1",
      name: "Research Agent",
      type: "RESEARCH",
      description: "Finds ideas",
      status: "IDLE",
      lastRun: null,
      placeholder: true,
    });
    expect(agent.lastRun).toBeNull();
  });

  it("maps nested research run history", () => {
    const run = mapResearchRun({
      id: "research-1",
      opportunityId: "opp-1",
      status: "COMPLETED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      confidence: { toNumber: () => 0.8 },
      providersAttempted: ["brave"],
      providersSucceeded: ["brave"],
      errors: [],
      queries: [{ query: "demand", source: "brave", purpose: "demand" }],
      evidence: [{
        id: "ev-1",
        source: "brave",
        title: "Result",
        url: "https://example.com",
        snippet: "Snippet",
        collectedAt: "2026-01-01T00:00:30.000Z",
        relevanceScore: { toNumber: () => 0.9 },
        qualityScore: { toNumber: () => 0.7 },
        hash: "hash-1",
        supports: ["demand"],
        contradicts: [],
      }],
      findings: [{
        id: "finding-1",
        claim: "Demand exists",
        summary: "Result",
        confidence: { toNumber: () => 0.7 },
        evidenceIds: ["ev-1"],
        contradictions: [],
      }],
    });

    expect(run.queries[0]?.purpose).toBe("demand");
    expect(run.evidence[0]?.qualityScore).toBe(0.7);
    expect(run.findings[0]?.evidenceIds).toEqual(["ev-1"]);
    expect(run.confidence).toBe(0.8);
  });
});
