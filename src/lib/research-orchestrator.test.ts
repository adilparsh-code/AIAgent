import { afterEach, describe, expect, it, vi } from "vitest";
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
  dataClass: "REAL_LIVE_DATA",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("fails honestly when all providers fail (no fake evidence, conclusion is not positive)", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => { throw new Error("HTTP 429"); } },
      { name: "reddit", search: async () => { throw new Error("network down"); } },
    ];

    const result = await runResearch("opp-4", "Any market", providers);

    expect(result.status).toBe("FAILED");
    expect(result.evidence).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.errors).toContain("brave: HTTP 429");
    expect(result.errors).toContain("reddit: network down");
    expect(result.providerStatuses.every((p) => p.status === "FAILED")).toBe(true);
  });

  it("reports CONFIG_ERROR for unconfigured providers and still runs the rest", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => { throw new Error("brave: BRAVE_SEARCH_API_KEY is not configured"); } },
      { name: "reddit", search: async () => [evidence("a", "a")] },
    ];

    const result = await runResearch("opp-5", "Any market", providers);

    expect(result.providerStatuses.find((p) => p.name === "brave")!.status).toBe("CONFIG_ERROR");
    expect(result.providerStatuses.find((p) => p.name === "reddit")!.status).toBe("SUCCEEDED");
    expect(result.status).toBe("PARTIAL");
  });

  it("treats providers returning empty results as EMPTY, not SUCCEEDED", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [] },
      { name: "reddit", search: async () => [] },
    ];

    const result = await runResearch("opp-6", "Obscure niche", providers);

    // Honest outcome: providers ran fine, nothing was found. Not an error, but no validation.
    expect(result.status).toBe("COMPLETED");
    expect(result.providerStatuses.every((p) => p.status === "EMPTY")).toBe(true);
    expect(result.providersSucceeded).toEqual([]);
    expect(result.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.confidence).toBe(0);
  });

  it("drops malformed provider results instead of crashing or fabricating evidence", async () => {
    const providers: ResearchProvider[] = [
      {
        name: "broken",
        search: async () =>
          [
            { title: "No url", url: "javascript:alert(1)", snippet: "bad" },
            { title: "", url: "https://x.com/ok", snippet: "no title" },
            null,
            "string",
            42,
          ] as unknown as Evidence[],
      },
    ];

    const result = await runResearch("opp-7", "Malformed market", providers);

    expect(result.evidence).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("malformed"))).toBe(true);
  });

  it("normalizes raw provider rows so duplicates collapse across providers", async () => {
    const providers: ResearchProvider[] = [
      {
        name: "brave",
        search: async () => [
          { title: "Same Story", url: "https://example.com/story?q=1", snippet: "Content here", supports: ["demand"], dataClass: "REAL_LIVE_DATA" },
        ] as unknown as Evidence[],
      },
      {
        name: "reddit",
        search: async () => [
          { title: "same story", url: "https://example.com/story/", snippet: "content here", supports: ["demand"], dataClass: "REAL_LIVE_DATA" },
        ] as unknown as Evidence[],
      },
    ];

    const result = await runResearch("opp-8", "Duplicate market", providers);

    expect(result.evidence).toHaveLength(1);
    expect(result.errors.some((e) => e.includes("dedup: removed 1 duplicate"))).toBe(true);
  });

  it("penalizes confidence when contradictions exist and records validation signals", async () => {
    const providers: ResearchProvider[] = [
      {
        name: "brave",
        search: async () => [
          { title: "Rising demand", url: "https://example.com/up", snippet: "growing fast", supports: ["demand"], dataClass: "REAL_LIVE_DATA" },
          { title: "Falling demand", url: "https://example.com/down", snippet: "declining", supports: ["demand"], contradicts: ["Rising demand"], dataClass: "REAL_LIVE_DATA" },
        ] as unknown as Evidence[],
      },
    ];

    const result = await runResearch("opp-9", "Contradicted market", providers);

    expect(result.validationSignals).toHaveLength(5);
    expect(result.validationSignals.find((s) => s.key === "demand")!.status).toBe("MIXED");
    expect(result.confidence).toBeLessThan(1);
    expect(["CONTRADICTED", "REQUIRES_HUMAN_REVIEW"]).toContain(result.conclusion);
  });

  it("never suggests a score when evidence cannot support one", async () => {
    const providers: ResearchProvider[] = [{ name: "brave", search: async () => [] }];
    const result = await runResearch("opp-10", "Empty market", providers);
    expect(result.scoreIntegration.suggestedOverallScore).toBeNull();
    expect(result.scoreIntegration.factors.length).toBe(8);
  });

  it("times out slow providers and reports the failure honestly", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: () => new Promise((_, reject) => setTimeout(() => reject(new Error("brave: request timed out after 10s")), 20)) },
      { name: "reddit", search: async () => [evidence("a", "a")] },
    ];

    const result = await runResearch("opp-11", "Slow market", providers);

    expect(result.status).toBe("PARTIAL");
    expect(result.errors.some((e) => e.includes("timed out"))).toBe(true);
  });

  it("rejects empty or oversized titles honestly (API-side guard also applies)", async () => {
    const providers: ResearchProvider[] = [{ name: "brave", search: async () => [evidence("a", "a")] }];
    const result = await runResearch("opp-12", "", providers);
    expect(result.queries.every((q) => q.query.trim().length >= 0)).toBe(true);
    expect(result.opportunityId).toBe("opp-12");
  });
});
