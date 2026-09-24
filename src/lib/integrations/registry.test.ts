import { describe, expect, it } from "vitest";
import { IntegrationRegistry, getIntegrationRegistry } from "./registry";
import type { ExecutionContext, ExecutionResult, HealthCheckResult, IntegrationAdapter } from "./contract";
import { capabilityRequiresApproval } from "./contract";
import { decidePermission, TASK_TYPE_ACTIONS } from "./permissions";
import { createScaffoldAdapters } from "./adapters/scaffolds";

function fakeAdapter(name: string, capabilities: IntegrationAdapter["capabilities"]): IntegrationAdapter {
  return {
    name,
    type: "RESEARCH",
    description: `fake ${name}`,
    capabilities,
    requiredEnvVars: [],
    timeoutMs: 1000,
    maxRetries: 1,
    validateConfiguration: () => ({ environment: "UNKNOWN", requiredEnvVars: [], presentEnvVars: [] }),
    healthCheck: async (): Promise<HealthCheckResult> => ({
      adapterName: name,
      status: "HEALTHY",
      checkedAt: new Date().toISOString(),
      durationMs: 1,
      error: null,
      capabilities: [...capabilities],
      environment: "UNKNOWN",
    }),
    execute: async (action: string, _payload: unknown, _context: ExecutionContext): Promise<ExecutionResult> => ({
      status: "SUCCEEDED",
      provider: name,
      action,
      externalId: null,
      output: null,
      rawDataAvailable: false,
      dataClass: "REAL_DATA",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
      error: null,
      usage: null,
      estimatedCost: null,
    }),
  };
}

describe("IntegrationRegistry", () => {
  it("registers, resolves, and lists adapters", () => {
    const registry = new IntegrationRegistry();
    const adapter = fakeAdapter("unit-a", ["SEARCH"]);
    registry.register(adapter);
    expect(registry.resolve("unit-a")).toBe(adapter);
    expect(registry.resolve("missing")).toBeNull();
    expect(registry.list().map((a) => a.name)).toContain("unit-a");
  });

  it("rejects duplicate registration by name", () => {
    const registry = new IntegrationRegistry();
    registry.register(fakeAdapter("dup", ["SEARCH"]));
    expect(() => registry.register(fakeAdapter("dup", ["SEARCH"]))).toThrowError(/already registered/);
  });

  it("throws on require() of an unknown adapter", () => {
    const registry = new IntegrationRegistry();
    expect(() => registry.require("nope")).toThrowError(/not registered/);
  });

  it("ships built-ins: AI provider, three research adapters, five scaffolds — no duplicates", () => {
    const registry = getIntegrationRegistry();
    const names = registry.list().map((a) => a.name);
    expect(names).toContain("sambanova");
    expect(names).toContain("brave-search");
    expect(names).toContain("reddit");
    expect(names).toContain("google-trends");
    for (const scaffold of createScaffoldAdapters()) {
      expect(names).toContain(scaffold.name);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("capability permission model", () => {
  it("maps task types to allowlisted actions and adapters", () => {
    expect(TASK_TYPE_ACTIONS.RESEARCH.map((entry) => entry.action)).toEqual([
      "SEARCH_WEB",
      "SEARCH_POSTS",
      "SEARCH_TRENDS",
    ]);
    expect(TASK_TYPE_ACTIONS.CONTENT_DRAFT).toEqual([
      { action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" },
    ]);
  });

  it("allows safe read/search actions without approval", () => {
    const decision = decidePermission({ taskType: "RESEARCH", action: "SEARCH_WEB" }, ["SEARCH", "READ_DATA"]);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.adapter).toBe("brave-search");
  });

  it("rejects actions outside the task-type allowlist (injection boundary)", () => {
    const decision = decidePermission(
      { taskType: "RESEARCH", action: "PUBLISH_PIN" },
      ["SEARCH", "READ_DATA", "PUBLISH"],
    );
    expect(decision.allowed).toBe(false);
    expect(decision.adapter).toBeNull();
  });

  it("rejects unknown task types entirely", () => {
    const decision = decidePermission({ taskType: "EXECUTE_SHELL", action: "RUN" }, ["SEARCH"]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("not mapped");
  });

  it("requires approval when the mapped capability is approval-class", () => {
    expect(capabilityRequiresApproval("PUBLISH")).toBe(true);
    // Current Phase 8 mappings carry only safe capabilities; verify the
    // approval flag flows through whenever an approval-class capability is
    // mapped, so future adapters cannot bypass the gate by accident.
    const entries = Object.entries(TASK_TYPE_ACTIONS).flatMap(([taskType, actions]) =>
      actions.map((entry) => ({ taskType, ...entry })),
    );
    for (const entry of entries) {
      const decision = decidePermission(
        { taskType: entry.taskType, action: entry.action },
        [entry.capability],
      );
      expect(decision.requiresApproval).toBe(capabilityRequiresApproval(entry.capability));
      expect(decision.allowed).toBe(true);
    }
  });

  it("rejects when the adapter does not declare the needed capability", () => {
    const decision = decidePermission({ taskType: "RESEARCH", action: "SEARCH_WEB" }, ["READ_DATA"]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("does not declare capability");
  });
});
