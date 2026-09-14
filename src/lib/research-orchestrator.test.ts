import { describe, expect, it } from "vitest";
import type { ResearchProvider } from "./base-provider";
import type { Evidence } from "./research-types";
import { runResearch } from "./research-orchestrator";

const evidence = (id: string, hash: string, contradicts: string[] = []): Evidence => ({
  id,
  source: "brave",
  title: `Result ${id}`,
  url: `https://example.com/${id}`,
  snippet: "Useful market evidence",
  collectedAt: new Date().toISOString(),
  relevanceScore: 0.9,
  qualityScore: 0.8,
  hash,
  supports: ["demand"],
  contradicts,
});

describe("runResearch", () => {
  it("returns structured research output from injected providers", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [evidence("a", "same"), evidence("b", "same")] },
      { name: "reddit", search: async () => [evidence("c", "reddit-1")] },
      { name: "google-trends", search: async () => [] },
    ];

    const result = await runResearch("opp-1", "Teacher worksheet generator", providers);

    expect(result.opportunityId).toBe("opp-1");
    expect(result.status).toBe("COMPLETED");
    expect(result.providersAttempted).toEqual(["brave", "reddit", "google-trends"]);
    expect(result.providersSucceeded).toEqual(["brave", "reddit"]);
    expect(result.evidence).toHaveLength(2);
    expect(result.findings[0]?.evidenceIds).toEqual(["a", "c"]);
  });

  it("degrades to PARTIAL when one provider fails but evidence remains", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [evidence("a", "a")] },
      { name: "reddit", search: async () => { throw new Error("rate limited"); } },
      { name: "google-trends", search: async () => [] },
    ];

    const result = await runResearch("opp-2", "Teacher utility", providers);

    expect(result.status).toBe("PARTIAL");
    expect(result.evidence).toHaveLength(1);
    expect(result.errors).toContain("reddit: rate limited");
  });

  it("preserves contradiction metadata in findings", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [evidence("a", "a", ["demand is weak"])] },
    ];

    const result = await runResearch("opp-3", "Worksheet market", providers);

    expect(result.findings[0]?.contradictions).toEqual(["demand is weak"]);
  });
});
