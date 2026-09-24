import { describe, expect, it } from "vitest";
import { summarizeResearchHistory } from "./research-history";

describe("research history intelligence", () => {
  it("builds chronological trends and latest-vs-previous deltas from persisted rows", () => {
    const summary = summarizeResearchHistory(
      [
        {
          id: "r2",
          startedAt: "2026-09-24T10:00:00Z",
          status: "COMPLETED",
          confidence: 0.8,
          evidenceCount: 6,
          sourceDiversity: 3,
          contradictionCount: 1,
        },
        {
          id: "r1",
          startedAt: "2026-09-23T10:00:00Z",
          status: "PARTIAL",
          confidence: 0.6,
          evidenceCount: 4,
          sourceDiversity: 2,
          contradictionCount: 2,
        },
      ],
      [
        { researchRunId: "r1", provider: "brave-search", status: "SUCCEEDED", evidenceCount: 3 },
        { researchRunId: "r2", provider: "brave-search", status: "SUCCEEDED", evidenceCount: 4 },
        { researchRunId: "r2", provider: "reddit", status: "FAILED", evidenceCount: 0 },
      ],
      [],
    );

    expect(summary.trend.map((point) => point.runId)).toEqual(["r1", "r2"]);
    expect(summary.latestVsPrevious).toEqual({
      confidenceDelta: 0.2,
      evidenceDelta: 2,
      sourceDiversityDelta: 1,
      contradictionDelta: -1,
    });
    expect(summary.providers[0]).toMatchObject({
      provider: "brave-search",
      attempts: 2,
      successes: 2,
      evidenceItems: 7,
    });
  });

  it("correlates repeated evidence by persisted hash across runs without fabricating matches", () => {
    const summary = summarizeResearchHistory(
      [
        { id: "r1", startedAt: "2026-09-20T00:00:00Z", status: "COMPLETED", confidence: 0.5, evidenceCount: 1, sourceDiversity: 1, contradictionCount: 0 },
        { id: "r2", startedAt: "2026-09-21T00:00:00Z", status: "COMPLETED", confidence: 0.7, evidenceCount: 2, sourceDiversity: 2, contradictionCount: 0 },
      ],
      [],
      [
        { researchRunId: "r1", hash: "same", source: "web", title: "A", url: "https://example.com/a", collectedAt: "2026-09-20T00:00:00Z" },
        { researchRunId: "r2", hash: "same", source: "web", title: "A", url: "https://example.com/a", collectedAt: "2026-09-21T00:00:00Z" },
        { researchRunId: "r2", hash: "new", source: "web", title: "B", url: "https://example.com/b", collectedAt: "2026-09-21T00:00:00Z" },
      ],
    );

    expect(summary.uniqueEvidenceCount).toBe(2);
    expect(summary.repeatedEvidenceCount).toBe(1);
    expect(summary.recurringEvidence[0]).toMatchObject({
      hash: "same",
      appearances: 2,
      runs: ["r1", "r2"],
    });
  });

  it("does not classify same-run duplicates as cross-run recurring evidence", () => {
    const summary = summarizeResearchHistory(
      [{ id: "r1", startedAt: "2026-09-20T00:00:00Z", status: "COMPLETED", confidence: 0.5, evidenceCount: 2, sourceDiversity: 1, contradictionCount: 0 }],
      [],
      [
        { researchRunId: "r1", hash: "same", source: "web", title: "A", url: "https://example.com/a", collectedAt: "2026-09-20T00:00:00Z" },
        { researchRunId: "r1", hash: "same", source: "web", title: "A", url: "https://example.com/a", collectedAt: "2026-09-20T00:00:00Z" },
      ],
    );

    expect(summary.repeatedEvidenceCount).toBe(0);
  });
});
