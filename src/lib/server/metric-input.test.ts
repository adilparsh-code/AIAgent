import { describe, expect, it } from "vitest";
import { validateMetricPayload, validateMetricRange } from "./metric-input";

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-01T23:59:59.000Z",
    impressions: 1000,
    ...overrides,
  };
}

describe("validateMetricPayload", () => {
  it("accepts a valid record with partial measurements", () => {
    const result = validateMetricPayload(basePayload({ revenue: 123.45, cost: undefined, notes: "from dashboard" }));
    expect(result.ok).toBe(true);
    expect(result.data?.revenue).toBe(123.45);
    expect(result.data?.cost).toBeNull(); // missing stays missing
    expect(result.data?.notes).toBe("from dashboard");
  });

  it("preserves explicit zero as a measurement", () => {
    const result = validateMetricPayload(basePayload({ impressions: 1000, clicks: 0, revenue: 0 }));
    expect(result.ok).toBe(true);
    expect(result.data?.clicks).toBe(0);
    expect(result.data?.revenue).toBe(0);
  });

  it("rejects negative values instead of coercing", () => {
    const result = validateMetricPayload(basePayload({ clicks: -5 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("clicks");
  });

  it("rejects non-finite and non-integer counts", () => {
    for (const bad of [Number.NaN, Infinity, 1.5, "12", null === null ? "x" : 0]) {
      const result = validateMetricPayload(basePayload({ visits: bad as unknown }));
      expect(result.ok).toBe(false);
    }
  });

  it("rejects malformed timestamps and inverted periods", () => {
    expect(validateMetricPayload(basePayload({ periodStart: "not-a-date" })).ok).toBe(false);
    expect(
      validateMetricPayload(
        basePayload({ periodStart: "2026-09-02T00:00:00Z", periodEnd: "2026-09-01T00:00:00Z" }),
      ).errors.join(" "),
    ).toContain("periodEnd");
  });

  it("rejects invalid dataClass and currency without silent conversion", () => {
    const badClass = validateMetricPayload(basePayload({ dataClass: "real" }));
    expect(badClass.ok).toBe(false);
    const badCurrency = validateMetricPayload(basePayload({ currency: "dollars" }));
    expect(badCurrency.ok).toBe(false);
    expect(validateMetricPayload(basePayload({ currency: "eur" })).data?.currency).toBe("EUR");
  });

  it("rejects records with no measurements at all", () => {
    const result = validateMetricPayload({ periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("at least one metric value");
  });

  it("defaults dataClass to REAL_DATA and recordedAt to a valid date", () => {
    const result = validateMetricPayload(basePayload());
    expect(result.ok).toBe(true);
    expect(result.data?.dataClass).toBe("REAL_DATA");
    expect(result.data?.recordedAt.getTime()).not.toBeNaN();
  });

  it("rejects a provided-but-invalid recordedAt instead of defaulting", () => {
    const result = validateMetricPayload(basePayload({ recordedAt: "yesterday" }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("recordedAt");
  });

  it("rejects non-object and array payloads", () => {
    expect(validateMetricPayload(null).ok).toBe(false);
    expect(validateMetricPayload([1, 2]).ok).toBe(false);
    expect(validateMetricPayload("metrics").ok).toBe(false);
  });
});

describe("validateMetricRange", () => {
  it("accepts absent, valid, and ordered ranges", () => {
    expect(validateMetricRange(new URLSearchParams()).ok).toBe(true);
    expect(
      validateMetricRange(new URLSearchParams("from=2026-09-01T00:00:00Z&to=2026-09-30T00:00:00Z")).ok,
    ).toBe(true);
  });

  it("rejects invalid or inverted ranges", () => {
    expect(validateMetricRange(new URLSearchParams("from=nope")).ok).toBe(false);
    expect(
      validateMetricRange(new URLSearchParams("from=2026-09-10T00:00:00Z&to=2026-09-01T00:00:00Z")).ok,
    ).toBe(false);
  });
});
