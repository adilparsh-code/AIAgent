import { describe, expect, it } from "vitest";
import { canFetchFeedback, validateFeedbackMetricRecord, type FeedbackMetricRecord } from "./feedback-contract";

const base: FeedbackMetricRecord = {
  externalId: "provider-record-1",
  experimentId: "exp-1",
  periodStart: "2026-01-01T00:00:00.000Z",
  periodEnd: "2026-01-02T00:00:00.000Z",
  visits: 10,
  conversions: 2,
  revenue: 25,
  source: "analytics.example/report-1",
  dataClass: "REAL_DATA",
};

describe("Phase 21 external feedback contract", () => {
  it("preserves real-data provenance and bounds input", () => {
    const result = validateFeedbackMetricRecord({ ...base, externalId: " x ".repeat(200), source: " analytics " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.dataClass).toBe("REAL_DATA");
      expect(result.record.source).toBe("analytics");
      expect(result.record.currency).toBe("USD");
      expect(result.record.externalId.length).toBeLessThanOrEqual(200);
    }
  });

  it("rejects REAL_DATA without provenance and malformed values", () => {
    const result = validateFeedbackMetricRecord({ ...base, source: "", visits: -1, dataClass: "REAL_DATA" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["source is required", "visits must be non-negative and finite"]));
  });

  it("does not treat configured or unavailable providers as callable", () => {
    expect(canFetchFeedback("HEALTHY")).toBe(true);
    expect(canFetchFeedback("NOT_CONFIGURED")).toBe(false);
    expect(canFetchFeedback("UNAVAILABLE")).toBe(false);
    expect(canFetchFeedback("AUTH_FAILED")).toBe(false);
  });

  it("keeps missing and non-real classes explicit", () => {
    const result = validateFeedbackMetricRecord({ ...base, source: "manual-review", dataClass: "NOT_MEASURED", visits: null, conversions: null, revenue: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.dataClass).toBe("NOT_MEASURED");
  });
});
