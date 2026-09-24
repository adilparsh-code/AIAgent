import { describe, expect, it } from "vitest";
import { calculateSystemHealth, makeHealthCheck, type SystemHealthCheck } from "./system-health";

const NOW = new Date("2026-09-24T12:00:00.000Z");
function check(component: SystemHealthCheck["component"], status: SystemHealthCheck["status"], message = "observed"): SystemHealthCheck { return makeHealthCheck({ component, status, message, now: NOW }); }

describe("system health", () => {
  it("reports healthy only when all checks are healthy", () => {
    const result = calculateSystemHealth({ checks: [check("DATABASE", "HEALTHY"), check("AUTHENTICATION", "HEALTHY")], now: NOW });
    expect(result.status).toBe("HEALTHY");
    expect(result.healthyComponents).toEqual(["AUTHENTICATION", "DATABASE"]);
    expect(result.criticalFailures).toEqual([]);
  });
  it("reports degraded and warnings", () => {
    const result = calculateSystemHealth({ checks: [check("DATABASE", "HEALTHY"), check("INTEGRATION_REGISTRY", "DEGRADED", "provider check not run")], now: NOW });
    expect(result.status).toBe("DEGRADED");
    expect(result.degradedComponents).toEqual(["INTEGRATION_REGISTRY"]);
    expect(result.warnings[0]).toContain("provider");
  });
  it("blocked takes precedence over degraded and unknown", () => {
    const result = calculateSystemHealth({ checks: [check("DATABASE", "BLOCKED"), check("RESEARCH", "DEGRADED"), check("AGENT_RUNTIME", "UNKNOWN")], now: NOW });
    expect(result.status).toBe("BLOCKED");
    expect(result.criticalFailures).toHaveLength(1);
  });
  it("unknown is retained when no stronger failure exists", () => {
    expect(calculateSystemHealth({ checks: [check("INTEGRATION_REGISTRY", "UNKNOWN", "no real health check")], now: NOW }).status).toBe("UNKNOWN");
  });
  it("is deterministic and sorted", () => {
    const a = calculateSystemHealth({ checks: [check("RESEARCH", "HEALTHY"), check("DATABASE", "HEALTHY")], now: NOW });
    const b = calculateSystemHealth({ checks: [check("DATABASE", "HEALTHY"), check("RESEARCH", "HEALTHY")], now: NOW });
    expect(a).toEqual(b);
    expect(a.checks.map((check) => check.component)).toEqual(["DATABASE", "RESEARCH"]);
  });
  it("does not claim provider health from configuration", () => {
    const result = calculateSystemHealth({ checks: [check("INTEGRATION_REGISTRY", "UNKNOWN", "configured but not checked")], now: NOW });
    expect(result.status).toBe("UNKNOWN");
    expect(result.healthyComponents).toEqual([]);
  });
});
