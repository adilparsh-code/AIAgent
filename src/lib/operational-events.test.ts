import { describe, expect, it } from "vitest";
import { createOperationalEvent, sanitizeOperationalMessage } from "./operational-events";

describe("operational events", () => {
  it("redacts credentials, cookies, authorization and connection strings", () => {
    const message = sanitizeOperationalMessage("Authorization: Bearer abc123 cookie=session123 DATABASE_URL=postgres://user:pass@host/db api_key=secret");
    expect(message).not.toContain("abc123");
    expect(message).not.toContain("session123");
    expect(message).not.toContain("user:pass");
    expect(message).toContain("[REDACTED]");
  });
  it("caps message and preserves optional identifiers", () => {
    const event = createOperationalEvent({ category: "EXECUTION", severity: "ERROR", event: "execution.failed", safeMessage: "x".repeat(700), opportunityId: "opp_1", taskId: "task_1", executionId: "exec_1", dataClass: "REAL_DATA", timestamp: new Date("2026-09-24T12:00:00Z") });
    expect(event.safeMessage.length).toBeLessThanOrEqual(500);
    expect(event.opportunityId).toBe("opp_1");
    expect(event.taskId).toBe("task_1");
    expect(event.executionId).toBe("exec_1");
  });
  it("preserves sample and estimated classes without upgrading them", () => {
    expect(createOperationalEvent({ category: "EXPERIMENT", severity: "INFO", event: "metric.recorded", safeMessage: "recorded", dataClass: "SAMPLE_DATA" }).dataClass).toBe("SAMPLE_DATA");
    expect(createOperationalEvent({ category: "EXPERIMENT", severity: "INFO", event: "metric.recorded", safeMessage: "recorded", dataClass: "ESTIMATED_DATA" }).dataClass).toBe("ESTIMATED_DATA");
  });
  it("is deterministic for equal inputs", () => {
    const input = { category: "SYSTEM" as const, severity: "INFO" as const, event: "health.checked", safeMessage: "ok", dataClass: "REAL_DATA" as const, timestamp: "2026-09-24T12:00:00Z" };
    expect(createOperationalEvent(input)).toEqual(createOperationalEvent(input));
  });
});
