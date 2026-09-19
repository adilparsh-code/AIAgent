import { afterEach, describe, expect, it, vi } from "vitest";
import { opportunityRepository } from "./opportunities";
import { SAMPLE_OPPORTUNITIES } from "../data/opportunities";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opportunityRepository", () => {
  it("keeps sample catalog data separate from persisted rows", async () => {
    const persisted = {
      id: "opp-user-1",
      title: "User opportunity",
      category: "SAAS",
      businessModel: "SAAS",
      targetAudience: "Teachers",
      problemSolved: "Saves time",
      monetizationMethod: "Subscription",
      estimatedStartupCost: 200,
      demandScore: 70,
      competitionScore: 40,
      commercialIntentScore: 70,
      automationScore: 80,
      differentiationScore: 60,
      monetizationStrengthScore: 65,
      halalScore: 90,
      halalStatus: "HALAL",
      overallScore: 71,
      confidence: 50,
      status: "IDEA",
      evidence: [],
      risks: [],
      nextAction: "Research",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [persisted],
      }),
    );

    const rows = await opportunityRepository.getAll();
    expect(rows.some((row) => row.id === "opp-user-1")).toBe(true);
    expect(rows.some((row) => row.id === SAMPLE_OPPORTUNITIES[0]?.id)).toBe(true);
    expect(await opportunityRepository.isSample(SAMPLE_OPPORTUNITIES[0]!.id)).toBe(true);
    expect(await opportunityRepository.isSample("opp-user-1")).toBe(false);
  });

  it("falls back to sample data when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "DATABASE_URL is not configured" }),
      }),
    );

    const rows = await opportunityRepository.getAll();
    expect(rows.map((row) => row.id).sort()).toEqual(SAMPLE_OPPORTUNITIES.map((row) => row.id).sort());
  });
});
