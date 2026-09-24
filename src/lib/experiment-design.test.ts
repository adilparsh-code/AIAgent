import { describe, expect, it } from "vitest";
import { buildExperimentDesign, assessExperimentReadiness } from "./experiment-design";
import type { OpportunityDecision } from "./opportunity-decision";
import type { OpportunityReadiness } from "./opportunity-readiness";

const design = buildExperimentDesign({
  opportunityId: "opp-1",
  hypothesis: "A measured offer will produce qualified visits.",
  objective: "Collect source-backed conversion observations.",
  successMetric: { name: "conversions", unit: "COUNT", direction: "HIGHER_IS_BETTER", sourceRequirement: "Provider export with period and source." },
  measurementWindow: { from: "2026-09-01T00:00:00Z", to: "2026-09-08T00:00:00Z" },
  expectedObservation: "Conversions may increase; this is not a result.",
  allowedCapability: "READ_DATA",
  measurementAvailable: false,
});

if (!design.ok) throw new Error("fixture design should be valid");

const decision = { decision: "VALIDATE", blockers: [], dataClass: "REAL_DATA" } as unknown as OpportunityDecision;
const readiness = {
  readinessState: "EXPERIMENT_REQUIRED",
  staleResearch: false,
  researchFreshness: { kind: "CURRENT_RESEARCH" },
  contradictions: [],
  missingEvidence: [],
  experimentReadiness: { realMetricPeriods: 0, estimatedMetricPeriods: 0 },
} as unknown as OpportunityReadiness;

describe("experiment design", () => {
  it("keeps a missing baseline NOT_MEASURED and expected observation non-result", () => {
    expect(design.design.baseline.status).toBe("NOT_MEASURED");
    expect(design.design.baseline.value).toBeNull();
    expect(design.design.expectedObservation.isMeasuredResult).toBe(false);
    expect(design.design.measurementStatus).toBe("NOT_MEASURED");
  });

  it("marks dangerous capabilities approval-gated", () => {
    const dangerous = buildExperimentDesign({
      opportunityId: "opp-1", hypothesis: "h", objective: "o",
      successMetric: { name: "clicks", unit: "COUNT", direction: "HIGHER_IS_BETTER", sourceRequirement: "source" },
      measurementWindow: { from: "2026-09-01", to: "2026-09-02" }, expectedObservation: "e",
      allowedCapability: "SEND_MESSAGE", measurementAvailable: true,
    });
    expect(dangerous.ok && dangerous.design.approvalRequired).toBe(true);
  });

  it("blocks execution when provider, measurement, or approval gates fail", () => {
    const result = assessExperimentReadiness({
      design: design.design, opportunityDecision: decision, opportunityReadiness: readiness,
      providerReady: false, providerReason: "No verified provider health check",
      capabilityAuthorized: false, capabilityReason: "Capability not verified",
      approvalGranted: false, measurementAvailable: false, idempotencyAvailable: true,
      stopConditionsConfigured: true, experimentStatus: "READY", duplicateExecution: false,
    });
    expect(result.ready).toBe(false);
    expect(result.state).not.toBe("READY");
    expect(result.blockers).toContain("No verified provider health check");
    expect(result.blockers).toContain("Measurement source is unavailable");
  });
});
