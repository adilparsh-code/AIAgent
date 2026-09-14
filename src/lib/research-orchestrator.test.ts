import { describe, expect, it } from "vitest";
import { runResearch } from "./research-orchestrator";

describe("runResearch", () => {
  it("returns structured research output and degrades gracefully", async () => {
    const result = await runResearch("opp-1", "Teacher worksheet generator");
    expect(result.id).toMatch(/^research-/);
    expect(result.opportunityId).toBe("opp-1");
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.providersAttempted).toEqual(expect.arrayContaining(["brave", "reddit", "google-trends"]));
    expect(["COMPLETED", "PARTIAL", "FAILED"]).toContain(result.status);
  });
});
