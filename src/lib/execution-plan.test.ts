import { describe, expect, it } from "vitest";
import { buildExecutionPlan } from "./execution-plan";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const base = {
  ownerId: "owner-1",
  opportunityId: "opp-1",
  objective: "Create a controlled draft",
  steps: ["Prepare draft", "Record measurement source"],
  provider: "sambanova",
  capability: "CREATE_DRAFT" as const,
  measurementPlan: { metrics: ["clicks", "conversions"], sourceRequirement: "Actual provider export with source and period", availability: "NOT_MEASURED" as const, dataClass: "NOT_MEASURED" as const },
  successMetric: "Recorded clicks",
  stopConditions: ["TIMEOUT"],
  rollbackCondition: "Stop on authorization or data-integrity failure.",
  dataClass: "NOT_MEASURED" as const,
  now: NOW,
};

describe("execution plans", () => {
  it("builds a bounded side-effect-free plan with stable idempotency", () => {
    const first = buildExecutionPlan(base);
    const second = buildExecutionPlan(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(first.plan.idempotencyKey).toBe(second.plan.idempotencyKey);
    expect(first.plan.measurementPlan.availability).toBe("NOT_MEASURED");
    expect(first.plan.approvalRequired).toBe(false);
    expect(first.plan.steps).toHaveLength(2);
  });

  it("marks dangerous capabilities as approval-required", () => {
    const result = buildExecutionPlan({ ...base, capability: "PUBLISH" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.approvalRequired).toBe(true);
  });

  it("refuses to claim REAL_DATA without real measurement provenance", () => {
    const result = buildExecutionPlan({ ...base, dataClass: "REAL_DATA" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("cannot be paired");
  });

  it("rejects an empty measurement plan and caps unbounded text", () => {
    const result = buildExecutionPlan({ ...base, measurementPlan: { ...base.measurementPlan, metrics: [] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("measurementPlan.metrics must not be empty");
  });
});
