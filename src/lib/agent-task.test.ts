import { describe, expect, it } from "vitest";
import {
  AGENT_ARTIFACT_DATA_CLASSES,
  AGENT_TASK_CONTRACT_VERSION,
  AGENT_TASK_LIMIT_BOUNDS,
  AGENT_TASK_LIMIT_DEFAULTS,
  AGENT_TASK_TYPES,
  AgentTaskValidationError,
  isAgentArtifactDataClass,
  isAgentTaskType,
  validateAgentTaskCreate,
} from "./agent-task";

describe("AgentTask contract", () => {
  it("exposes version 1, the full status set, and the allowlisted task types", () => {
    expect(AGENT_TASK_CONTRACT_VERSION).toBe(1);
    expect(AGENT_TASK_TYPES).toContain("RESEARCH");
    expect(AGENT_TASK_TYPES).toContain("EXPERIMENT_ANALYSIS");
    expect(AGENT_TASK_TYPES).toContain("REPORT_GENERATION");
    expect(AGENT_TASK_TYPES).toHaveLength(9);
  });

  it("defaults the budget to zero and declares safe limit bounds", () => {
    expect(AGENT_TASK_LIMIT_DEFAULTS.budgetLimit).toBe(0);
    expect(AGENT_TASK_LIMIT_BOUNDS.timeLimitSeconds.max).toBeLessThanOrEqual(900);
    expect(AGENT_TASK_LIMIT_BOUNDS.maxRetries.max).toBeLessThanOrEqual(5);
    expect(AGENT_TASK_LIMIT_BOUNDS.budgetLimit.min).toBe(0);
  });

  it("keeps AI artifact data classes distinct from real measurements", () => {
    expect(AGENT_ARTIFACT_DATA_CLASSES).toEqual([
      "REAL_DATA",
      "AI_GENERATED",
      "AI_ESTIMATE",
      "SAMPLE_DATA",
    ]);
    expect(isAgentArtifactDataClass("AI_GENERATED")).toBe(true);
    expect(isAgentArtifactDataClass("REAL_DATA")).toBe(true);
    expect(isAgentArtifactDataClass("ESTIMATED_DATA")).toBe(false);
    expect(isAgentArtifactDataClass(42)).toBe(false);
  });
});

describe("isAgentTaskType", () => {
  it("accepts exactly the allowlist and rejects everything else", () => {
    expect(isAgentTaskType("CONTENT_DRAFT")).toBe(true);
    expect(isAgentTaskType("PIN_CONTENT_DRAFT")).toBe(true);
    // Not in the allowlist — including obvious dangerous capabilities.
    expect(isAgentTaskType("EXECUTE_SHELL")).toBe(false);
    expect(isAgentTaskType("SPEND_MONEY")).toBe(false);
    expect(isAgentTaskType("content_draft")).toBe(false); // case-sensitive
    expect(isAgentTaskType(undefined)).toBe(false);
    expect(isAgentTaskType(123)).toBe(false);
  });
});

describe("validateAgentTaskCreate", () => {
  const valid = {
    agentId: "agent-1",
    taskType: "REPORT_GENERATION",
    objective: "Summarize the experiment results into a report.",
  };

  it("accepts a minimal valid task and applies defaults", () => {
    const result = validateAgentTaskCreate(valid);
    expect(result.agentId).toBe("agent-1");
    expect(result.taskType).toBe("REPORT_GENERATION");
    expect(result.instructions).toBe("");
    expect(result.expectedOutputs).toEqual([]);
    expect(result.constraints).toEqual([]);
    expect(result.opportunityId).toBeUndefined();
    expect(result.experimentId).toBeUndefined();
    expect(result.limits).toBeUndefined();
  });

  it("round-trips optional structured input and limits", () => {
    const result = validateAgentTaskCreate({
      ...valid,
      instructions: "Use only the recorded metrics provided.",
      inputs: { experimentId: "exp-1", metrics: { visits: 100 } },
      expectedOutputs: ["experiment_report"],
      constraints: ["No external publishing"],
      opportunityId: "opp-1",
      experimentId: "exp-1",
      requiresApproval: true,
      limits: { timeLimitSeconds: 60, budgetLimit: 25 },
    });
    expect(result.inputs).toEqual({ experimentId: "exp-1", metrics: { visits: 100 } });
    expect(result.expectedOutputs).toEqual(["experiment_report"]);
    expect(result.limits).toEqual({ timeLimitSeconds: 60, budgetLimit: 25 });
    expect(result.requiresApproval).toBe(true);
  });

  it("rejects a task type outside the allowlist", () => {
    expect(() => validateAgentTaskCreate({ ...valid, taskType: "EXECUTE_SHELL" })).toThrowError(
      AgentTaskValidationError,
    );
    try {
      validateAgentTaskCreate({ ...valid, taskType: "SPEND_MONEY" });
    } catch (error) {
      expect((error as AgentTaskValidationError).field).toBe("taskType");
    }
  });

  it("rejects missing/empty objective and oversized text", () => {
    expect(() => validateAgentTaskCreate({ ...valid, objective: "   " })).toThrowError(
      /objective is required/,
    );
    expect(() =>
      validateAgentTaskCreate({ ...valid, objective: "x".repeat(601) }),
    ).toThrowError(/exceeds 600/);
    expect(() =>
      validateAgentTaskCreate({ ...valid, instructions: "x".repeat(4001) }),
    ).toThrowError(/exceeds 4000/);
    expect(() => validateAgentTaskCreate({ agentId: "", taskType: "RESEARCH", objective: "ok" })).toThrowError(
      /agentId is required/,
    );
  });

  it("rejects malformed structured payloads without coercion", () => {
    expect(() => validateAgentTaskCreate({ ...valid, inputs: "not-an-object" })).toThrowError(
      /inputs must be a JSON object/,
    );
    expect(() =>
      validateAgentTaskCreate({ ...valid, inputs: { big: "x".repeat(21_000) } }),
    ).toThrowError(/inputs exceed/);
    expect(() => validateAgentTaskCreate({ ...valid, expectedOutputs: "report" })).toThrowError(
      /must be an array/,
    );
    expect(() =>
      validateAgentTaskCreate({ ...valid, expectedOutputs: [123] }),
    ).toThrowError(/must be a string/);
    expect(() =>
      validateAgentTaskCreate({ ...valid, expectedOutputs: ["x".repeat(201)] }),
    ).toThrowError(/exceeds 200/);
  });

  it("rejects ids over 64 characters and non-object bodies", () => {
    expect(() =>
      validateAgentTaskCreate({ ...valid, opportunityId: "x".repeat(65) }),
    ).toThrowError(/at most 64/);
    expect(() => validateAgentTaskCreate(null)).toThrowError(/JSON object/);
    expect(() => validateAgentTaskCreate([valid])).toThrowError(/JSON object/);
    expect(() => validateAgentTaskCreate("task")).toThrowError(/JSON object/);
  });

  it("rejects non-finite and out-of-bounds limits per field", () => {
    expect(() => validateAgentTaskCreate({ ...valid, limits: { budgetLimit: -1 } })).toThrowError(
      /between 0 and/,
    );
    expect(() =>
      validateAgentTaskCreate({ ...valid, limits: { timeLimitSeconds: Number.POSITIVE_INFINITY } }),
    ).toThrowError(/finite number/);
    expect(() => validateAgentTaskCreate({ ...valid, limits: { maxRetries: 6 } })).toThrowError(
      /between 1 and 5/,
    );
    expect(() =>
      validateAgentTaskCreate({ ...valid, limits: { timeLimitSeconds: "fast" } }),
    ).toThrowError(/finite number/);
    expect(() => validateAgentTaskCreate({ ...valid, limits: [] })).toThrowError(/JSON object/);
  });
});
