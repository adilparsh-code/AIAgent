import { describe, expect, it } from "vitest";
import { deriveExecutionLearning } from "./execution-learning";

describe("execution learning", () => {
  it("keeps completion without real measurement as NOT_MEASURED", () => {
    const result = deriveExecutionLearning({ opportunityId: "opp-1", observations: [] });
    expect(result.measurementStatus).toBe("NOT_MEASURED");
    expect(result.dataClass).toBe("NOT_MEASURED");
    expect(result.learningSignal).toBe("INSUFFICIENT_DATA");
    expect(result.nextAction).toBe("RECORD_MORE_DATA");
  });

  it("never upgrades sample or estimated observations to REAL_DATA", () => {
    const result = deriveExecutionLearning({
      opportunityId: "opp-1",
      observations: [
        { metric: "clicks", value: 999, dataClass: "SAMPLE_DATA", source: "fixture", observedAt: "2026-09-24T00:00:00Z" },
        { metric: "revenue", value: 99999, dataClass: "ESTIMATED_DATA", source: "estimate", observedAt: "2026-09-24T00:00:00Z" },
      ],
    });
    expect(result.measurementStatus).toBe("NOT_MEASURED");
    expect(result.dataClass).toBe("ESTIMATED_DATA");
    expect(result.learningSignal).toBe("INSUFFICIENT_DATA");
  });

  it("reports a real observation and baseline without predicting future income", () => {
    const result = deriveExecutionLearning({
      opportunityId: "opp-1",
      observations: [
        { metric: "conversions", value: 4, dataClass: "REAL_DATA", source: "analytics export", observedAt: "2026-09-24T00:00:00Z" },
        { metric: "clicks", value: 100, dataClass: "REAL_DATA", source: "analytics export", observedAt: "2026-09-24T00:00:00Z" },
        { metric: "impressions", value: 1000, dataClass: "REAL_DATA", source: "analytics export", observedAt: "2026-09-24T00:00:00Z" },
      ],
      baseline: { value: 2, source: "prior analytics export", measuredAt: "2026-09-23T00:00:00Z" },
    });
    expect(result.measurementStatus).toBe("MEASURED");
    expect(result.dataClass).toBe("REAL_DATA");
    expect(result.observedChange).toBe(2);
    expect(result.basis.join(" ")).toContain("not a prediction");
  });
});
