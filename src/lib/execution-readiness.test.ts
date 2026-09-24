import { describe, expect, it } from "vitest";
import { assessExecutionReadiness, type ExecutionReadinessInput } from "./execution-readiness";
import type { OpportunityDecision } from "./opportunity-decision";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const decision: OpportunityDecision = {
  opportunityId: "opp-1",
  decision: "EXECUTION_READY",
  decisionScore: 90,
  readinessState: "READY_FOR_EXECUTION",
  confidence: 90,
  blockers: [],
  evidenceGaps: [],
  validationGaps: [],
  experimentGaps: [],
  executionGaps: [],
  recommendedAction: { action: "Execute the approved task.", basis: "Gates passed" },
  explanation: [],
  dataClass: "REAL_DATA",
  generatedAt: NOW.toISOString(),
  decisionInputs: { readinessApplied: true, validationApplied: true, experimentApplied: true, handoffApplied: true, executionApplied: true, freshnessApplied: true },
  lifecycleState: "EXECUTION_READY",
};

function input(overrides: Partial<ExecutionReadinessInput> = {}): ExecutionReadinessInput {
  return {
    authenticated: true,
    ownerId: "owner-1",
    opportunityId: "opp-1",
    opportunityOwned: true,
    decision,
    handoffStatus: "ACCEPTED",
    validationCompleted: true,
    experimentState: "READY",
    learningSignalAvailable: true,
    provider: { name: "brave-search", status: "HEALTHY", healthCheckedAt: NOW.toISOString(), configured: true },
    capability: "SEARCH",
    capabilityAuthorized: true,
    approvalRequired: false,
    approvalGranted: false,
    measurementAvailable: true,
    measurementDataClass: "REAL_DATA",
    stopConditions: ["TIMEOUT"],
    stopped: false,
    idempotencyKey: "owner-1:opp-1:brave:SEARCH:LIVE",
    existingExecution: false,
    dataClass: "REAL_DATA",
    now: NOW,
    ...overrides,
  };
}

describe("execution readiness", () => {
  it("is ready only when every safety gate passes", () => {
    const result = assessExecutionReadiness(input());
    expect(result.state).toBe("READY");
    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.approvalStatus).toBe("NOT_REQUIRED");
  });

  it("fails closed for unauthenticated or unowned requests", () => {
    const result = assessExecutionReadiness(input({ authenticated: false, opportunityOwned: false }));
    expect(result.state).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("Authenticated");
    expect(result.reasons.join(" ")).toContain("ownership");
  });

  it("never executes a dangerous capability without approval", () => {
    const result = assessExecutionReadiness(input({ capability: "PUBLISH", approvalRequired: true, approvalGranted: false }));
    expect(result.state).toBe("HUMAN_REVIEW");
    expect(result.approvalStatus).toBe("WAITING_APPROVAL");
    expect(result.nextAction).toContain("WAIT_FOR_APPROVAL");
    expect(result.ready).toBe(false);
  });

  it("does not treat provider configuration as health", () => {
    const result = assessExecutionReadiness(input({ provider: { name: "provider", status: "CONFIGURED", healthCheckedAt: null, configured: true } }));
    expect(result.state).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("real health check");
  });

  it("rejects non-real measurement and duplicate or stopped execution", () => {
    const result = assessExecutionReadiness(input({ measurementDataClass: "ESTIMATED_DATA", stopped: true, existingExecution: true }));
    expect(result.state).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("REAL_DATA");
    expect(result.reasons.join(" ")).toContain("stopped");
    expect(result.reasons.join(" ")).toContain("duplicate");
  });
});
