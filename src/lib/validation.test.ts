import { describe, expect, it } from "vitest";
import type { Evidence } from "./research-types";
import { VALIDATION_RULES, buildConclusion, buildScoreIntegration, buildValidationSignals, countContradictions } from "./validation";

const evidence = (
  id: string,
  source: string,
  supports: Evidence["supports"],
  opts: { quality?: number; contradicts?: string[] } = {},
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

const demandEvidence = (count: number, sources = 2, quality = 0.8) =>
  Array.from({ length: count }, (_, i) =>
    evidence(`d${i}`, i % sources === 0 ? "brave" : "reddit", ["demand"], { quality }),
  );

describe("buildValidationSignals", () => {
  it("returns INSUFFICIENT when no evidence supports a purpose", () => {
    const signals = buildValidationSignals([]);
    expect(signals).toHaveLength(5);
    expect(signals.every((s) => s.status === "INSUFFICIENT")).toBe(true);
  });

  it("returns MIXED when evidence exists but is below the SUPPORTED thresholds", () => {
    const signals = buildValidationSignals(demandEvidence(1, 1));
    expect(signals.find((s) => s.key === "demand")!.status).toBe("MIXED");
  });

  it("returns SUPPORTED with enough quality items from enough sources", () => {
    const signals = buildValidationSignals(demandEvidence(VALIDATION_RULES.SUPPORTED_MIN_EVIDENCE, 2));
    expect(signals.find((s) => s.key === "demand")!.status).toBe("SUPPORTED");
  });

  it("requires multiple providers for SUPPORTED (single-source evidence stays MIXED)", () => {
    const signals = buildValidationSignals(demandEvidence(10, 1));
    expect(signals.find((s) => s.key === "demand")!.status).toBe("MIXED");
  });

  it("downgrades to MIXED when contradicted evidence exists", () => {
    const items = [
      ...demandEvidence(VALIDATION_RULES.SUPPORTED_MIN_EVIDENCE, 2),
      evidence("contra", "brave", ["demand"], { contradicts: ["market is shrinking"] }),
    ];
    const signals = buildValidationSignals(items);
    expect(signals.find((s) => s.key === "demand")!.status).toBe("MIXED");
  });

  it("requires minimum average quality for SUPPORTED", () => {
    const signals = buildValidationSignals(demandEvidence(5, 2, 0.2));
    expect(signals.find((s) => s.key === "demand")!.status).toBe("MIXED");
  });

  it("traces every signal to evidence ids", () => {
    const signals = buildValidationSignals(demandEvidence(2, 1));
    const demand = signals.find((s) => s.key === "demand")!;
    expect(demand.evidenceIds).toHaveLength(2);
    expect(demand.basis).toContain("evidence item(s)");
  });
});

describe("countContradictions", () => {
  it("counts evidence and finding contradictions", () => {
    const items = [evidence("a", "brave", ["demand"], { contradicts: ["x", "y"] })];
    const findings = [{ id: "f", claim: "", summary: "", confidence: 0.5, evidenceIds: ["a"], contradictions: ["z"] }];
    expect(countContradictions(items, findings)).toBe(3);
  });
});

describe("buildConclusion", () => {
  const signals = (statuses: Array<"SUPPORTED" | "MIXED" | "INSUFFICIENT">) =>
    statuses.map((status, i) => ({
      key: `sig${i}`,
      label: `Signal ${i}`,
      status,
      evidenceIds: [],
      basis: "",
    }));

  it("returns INSUFFICIENT_EVIDENCE with no evidence", () => {
    const result = buildConclusion([], buildValidationSignals([]), 0, 0, 3, 0);
    expect(result.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.basis).toContain("No evidence collected");
  });

  it("never returns VALIDATED from research success alone", () => {
    const result = buildConclusion(
      demandEvidence(1, 1),
      signals(["INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT"]),
      0.9,
      0,
      3,
      3,
    );
    expect(result.conclusion).not.toBe("VALIDATED");
  });

  it("returns VALIDATED only with >= 2 supported signals and no contradictions", () => {
    const result = buildConclusion(
      demandEvidence(6, 2),
      signals(["SUPPORTED", "SUPPORTED", "INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT"]),
      0.8,
      0,
      3,
      2,
    );
    expect(result.conclusion).toBe("VALIDATED");
  });

  it("downgrades to REQUIRES_HUMAN_REVIEW when supported signals coexist with contradictions", () => {
    const items = [
      ...demandEvidence(6, 2),
      evidence("contra", "brave", ["commercial-intent"], { contradicts: ["few buyers"] }),
    ];
    const result = buildConclusion(items, buildValidationSignals(items), 0.8, 1, 3, 2);
    expect(result.conclusion).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("returns CONTRADICTED when a signal is contradicted and none are supported", () => {
    const items = [
      evidence("a", "brave", ["demand"], { contradicts: ["demand is falling"] }),
      evidence("b", "reddit", ["pain-point"]),
    ];
    const result = buildConclusion(items, buildValidationSignals(items), 0.6, 1, 2, 2);
    expect(result.conclusion).toBe("CONTRADICTED");
  });

  it("returns PROMISING for mixed signals with adequate confidence", () => {
    const result = buildConclusion(
      demandEvidence(2, 1),
      signals(["MIXED", "MIXED", "INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT"]),
      0.7,
      0,
      3,
      1,
    );
    expect(result.conclusion).toBe("PROMISING");
  });
});

describe("buildScoreIntegration", () => {
  it("leaves non-informable factors unchanged and marks compliance as human review", () => {
    const signals = buildValidationSignals(demandEvidence(6, 2));
    const result = buildScoreIntegration(signals, "VALIDATED", demandEvidence(6, 2));
    const byKey = new Map(result.factors.map((f) => [f.key, f]));
    expect(byKey.get("startupCost")!.status).toBe("unchanged");
    expect(byKey.get("automationPotential")!.status).toBe("unchanged");
    expect(byKey.get("differentiation")!.status).toBe("unchanged");
    expect(byKey.get("halalCompliance")!.status).toBe("human-review-required");
    expect(byKey.get("demand")!.status).toBe("research-supported");
  });

  it("does not suggest a score when evidence is insufficient", () => {
    const signals = buildValidationSignals([]);
    const result = buildScoreIntegration(signals, "INSUFFICIENT_EVIDENCE", []);
    expect(result.suggestedOverallScore).toBeNull();
    expect(result.note).toContain("human review");
  });
});
