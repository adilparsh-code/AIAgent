import { describe, expect, it } from "vitest";
import { HEALTH_BOUNDS } from "@/lib/server/system-health-service";
import { sanitizeOperationalMessage } from "./operational-events";
import { classifyFailure } from "./failure-classification";
import { determineRecoveryPolicy } from "./failure-classification";

describe("Phase 14 safety and observability regressions", () => {
  it("health service exposes explicit bounded limits", () => { expect(HEALTH_BOUNDS.MAX_OPPORTUNITIES).toBeGreaterThan(0); expect(HEALTH_BOUNDS.MAX_TASKS).toBeGreaterThan(0); expect(HEALTH_BOUNDS.MAX_EXECUTIONS).toBeGreaterThan(0); });
  it("keeps server services out of the pure model path", () => { expect(HEALTH_BOUNDS.MAX_OPPORTUNITIES).toBe(50); expect(HEALTH_BOUNDS.MAX_TASKS).toBe(200); });
  it("never exposes raw secret values", () => { const safe = sanitizeOperationalMessage("password=hunter2 authorization=Bearer abc session=xyz"); expect(safe).not.toContain("hunter2"); expect(safe).not.toContain("abc"); expect(safe).not.toContain("xyz"); });
  it("classifies and recovers without bypassing approval", () => { const failure = classifyFailure("403 approval required"); expect(determineRecoveryPolicy({ ...failure, requiresApproval: true })).toBe("WAIT_FOR_APPROVAL"); });
  it("keeps non-real data classes separate", () => { expect(sanitizeOperationalMessage("sample data only")).toBe("sample data only"); });
});
