import { describe, expect, it } from "vitest";
import { experimentStatusAfterExecution } from "./experiment-lifecycle";

describe("experiment lifecycle after execution", () => {
  it("does not mark a successful provider call as experiment completion", () => {
    expect(experimentStatusAfterExecution("SUCCEEDED")).toBe("ACTIVE");
  });
  it("maps provider safety failures to stopped/failed states", () => {
    expect(experimentStatusAfterExecution("AUTH_FAILED")).toBe("STOPPED");
    expect(experimentStatusAfterExecution("RATE_LIMITED")).toBe("PAUSED");
    expect(experimentStatusAfterExecution("FAILED")).toBe("FAILED");
  });
});
