import { describe, expect, it } from "vitest";
import type { ResearchProvider } from "./base-provider";
import type { Evidence } from "./research-types";
import { dedupeSeeds, runDiscovery } from "./discovery-engine";
import { generateCandidates } from "./discovery-candidates";
import { markHandoffPrepared } from "./opportunity-brief";

const evidence = (
  id: string,
  source: Evidence["source"],
  supports: Evidence["supports"],
  opts: { contradicts?: string[]; quality?: number } = {},
): Evidence => ({
  id,
  source,
  title: `Result ${id}`,
  url: `https://example.com/${id}`,
  snippet: "Market evidence",
  collectedAt: new Date().toISOString(),
  relevanceScore: opts.quality ?? 0.8,
  qualityScore: opts.quality ?? 0.8,
  hash: `hash-${id}`,
  supports,
  contradicts: opts.contradicts ?? [],
  dataClass: "REAL_LIVE_DATA",
});

function supportedSet(prefix: string): Evidence[] {
  return [
    evidence(`${prefix}-d1`, "brave", ["demand"]),
    evidence(`${prefix}-d2`, "reddit", ["demand"]),
    evidence(`${prefix}-d3`, "brave", ["demand"]),
    evidence(`${prefix}-p1`, "brave", ["pain-point"]),
    evidence(`${prefix}-p2`, "reddit", ["pain-point"]),
    evidence(`${prefix}-p3`, "brave", ["pain-point"]),
    evidence(`${prefix}-c1`, "brave", ["commercial-intent"]),
    evidence(`${prefix}-c2`, "reddit", ["commercial-intent"]),
    evidence(`${prefix}-c3`, "brave", ["commercial-intent"]),
  ];
}

describe("dedupeSeeds", () => {
  it("skips seeds that share a normalized key or a prior key", () => {
    const seeds = generateCandidates("worksheets", "education", {
      extraTitles: ["Worksheets education offer"],
      maxCandidates: 5,
    });
    const { unique, duplicates } = dedupeSeeds(seeds, new Set([seeds[0]!.normalizedKey]));
    expect(unique.every((seed) => seed.normalizedKey !== seeds[0]!.normalizedKey)).toBe(true);
    expect(duplicates.length + unique.length).toBe(seeds.length);
  });
});

describe("runDiscovery", () => {
  it("researches generated candidates through injected providers", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [evidence("a", "brave", ["demand"])] },
      { name: "reddit", search: async () => [evidence("b", "reddit", ["pain-point"])] },
      { name: "google-trends", search: async () => [] },
    ];

    const { result } = await runDiscovery({
      topic: "teacher worksheets",
      category: "education",
      maxCandidates: 2,
      providers,
      harvestFromProviders: false,
    });

    expect(result.candidateCount).toBe(2);
    expect(result.researchedCount).toBe(2);
    expect(result.candidates.every((item) => item.status === "RESEARCHED")).toBe(true);
    expect(result.candidates.every((item) => item.researchRunId)).toBe(true);
    expect(result.notes).toContain("hypotheses");
  });

  it("treats provider failure honestly and does not invent evidence", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => { throw new Error("HTTP 429"); } },
      { name: "reddit", search: async () => { throw new Error("network down"); } },
    ];

    const { result } = await runDiscovery({
      topic: "teacher worksheets",
      category: "education",
      maxCandidates: 1,
      providers,
      harvestFromProviders: false,
    });

    const candidate = result.candidates[0]!;
    expect(candidate.evidenceCount).toBe(0);
    expect(candidate.validationConclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(candidate.handoffStatus).toBe("NOT_READY");
    expect(candidate.rankingScore ?? 0).toBeLessThanOrEqual(15);
    expect(candidate.errors.some((item) => item.includes("HTTP 429") || item.includes("network down"))).toBe(true);
  });

  it("records insufficient evidence instead of treating missing data as support", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => [] },
      { name: "reddit", search: async () => [] },
      { name: "google-trends", search: async () => [] },
    ];

    const { result } = await runDiscovery({
      topic: "obscure niche xyz",
      category: "other",
      maxCandidates: 1,
      providers,
      harvestFromProviders: false,
    });

    const candidate = result.candidates[0]!;
    expect(candidate.evidenceCoverage).toBe(0);
    expect(candidate.validationConclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(candidate.brief?.demandEvidence.status).toBe("INSUFFICIENT");
    expect(candidate.brief?.monetizationPossibilities.options).toEqual([]);
    expect(candidate.rankingBreakdown?.factors.find((f) => f.key === "demand")?.provenance).toBe("unmeasured");
    expect(candidate.handoffStatus).toBe("NOT_READY");
  });

  it("surfaces contradictory evidence and does not mark handoff ready", async () => {
    const providers: ResearchProvider[] = [
      {
        name: "brave",
        search: async () => [
          evidence("up", "brave", ["demand"], { contradicts: ["market is shrinking"] }),
          evidence("down", "brave", ["pain-point"]),
        ],
      },
    ];

    const { result } = await runDiscovery({
      topic: "contradicted market",
      category: "saas",
      maxCandidates: 1,
      providers,
      harvestFromProviders: false,
    });

    const candidate = result.candidates[0]!;
    expect(candidate.contradictionCount).toBeGreaterThan(0);
    expect(["CONTRADICTED", "REQUIRES_HUMAN_REVIEW"]).toContain(candidate.validationConclusion);
    expect(candidate.handoffStatus).toBe("NOT_READY");
    expect(candidate.brief?.contradictions.length).toBeGreaterThan(0);
  });

  it("ranks evidence-backed candidates above empty ones and separates score provenance", async () => {
    const providers: ResearchProvider[] = [
      {
        name: "brave",
        search: async (query) => (query.query.includes("problem-solver") ? [] : supportedSet("first")),
      },
      {
        name: "reddit",
        search: async (query) => (query.query.includes("problem-solver") ? [] : supportedSet("reddit")),
      },
    ];

    const { result } = await runDiscovery({
      topic: "rank me",
      category: "apps",
      maxCandidates: 2,
      providers,
      harvestFromProviders: false,
    });

    expect(result.candidates[0]!.rank).toBe(1);
    expect(result.candidates[0]!.evidenceCount).toBeGreaterThan(result.candidates[1]!.evidenceCount);
    const factors = result.candidates[0]!.rankingBreakdown?.factors ?? [];
    expect(factors.some((item) => item.provenance === "evidence-backed")).toBe(true);
    expect(factors.find((item) => item.key === "ai-estimate")?.provenance).toBe("ai-estimate");
    expect(result.candidates[0]!.rankingBreakdown?.aiEstimateScore).toBeNull();
  });

  it("builds a handoff contract that is machine-readable and not executed", async () => {
    const providers: ResearchProvider[] = [
      { name: "brave", search: async () => supportedSet("b") },
      { name: "reddit", search: async () => supportedSet("r") },
    ];

    const { result } = await runDiscovery({
      topic: "handoff market",
      category: "education",
      maxCandidates: 1,
      providers,
      harvestFromProviders: false,
    });

    const handoff = result.candidates[0]!.handoffPayload;
    expect(handoff).not.toBeNull();
    expect(handoff).toMatchObject({
      title: expect.any(String),
      validationConclusion: expect.any(String),
      confidence: expect.any(Number),
      score: expect.any(Number),
      recommendedExperiment: expect.any(String),
    });
    expect(handoff?.evidence.urls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(handoff?.handoffStatus).toBe("READY");
    expect(markHandoffPrepared(handoff!).handoffStatus).toBe("PREPARED");
    expect(handoff?.handoffStatus).toBe("READY");
  });
});
