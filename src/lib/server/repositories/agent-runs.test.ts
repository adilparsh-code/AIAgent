import { describe, expect, it } from "vitest";

/**
 * API-validation rules extracted as pure helpers so they are testable without
 * a server or database. The API routes must keep using these same rules.
 */
const AGENT_RUN_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;

function normalizeAgentRunInput(body: {
  task?: unknown;
  status?: unknown;
  errors?: unknown;
}): { ok: true; value: { task: string; status: (typeof AGENT_RUN_STATUSES)[number]; errors: string[] } } | { ok: false; error: string } {
  if (typeof body.task !== "string" || body.task.trim().length === 0) {
    return { ok: false, error: "task is required" };
  }
  const status =
    typeof body.status === "string" && (AGENT_RUN_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as (typeof AGENT_RUN_STATUSES)[number])
      : "RUNNING";
  const errors = Array.isArray(body.errors)
    ? body.errors.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  return { ok: true, value: { task: body.task.trim().slice(0, 500), status, errors } };
}

describe("agent run input normalization", () => {
  it("rejects missing or empty task", () => {
    expect(normalizeAgentRunInput({}).ok).toBe(false);
    expect(normalizeAgentRunInput({ task: "   " }).ok).toBe(false);
    expect(normalizeAgentRunInput({ task: 42 }).ok).toBe(false);
  });

  it("accepts a valid task and defaults status to RUNNING", () => {
    const result = normalizeAgentRunInput({ task: "  collect demand evidence  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task).toBe("collect demand evidence");
      expect(result.value.status).toBe("RUNNING");
    }
  });

  it("rejects invalid statuses and drops non-string errors", () => {
    const result = normalizeAgentRunInput({ task: "x", status: "NOT_A_STATUS", errors: ["a", 5, null, "b"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("RUNNING");
      expect(result.value.errors).toEqual(["a", "b"]);
    }
  });
});
