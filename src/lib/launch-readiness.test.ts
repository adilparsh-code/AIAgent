import { describe, expect, it } from "vitest";
import {
  calculateLaunchReadiness,
  LAUNCH_GATE_IDS,
  makeLaunchGate,
  type LaunchGate,
  type LaunchGateId,
} from "./launch-readiness";

const NOW = new Date("2026-09-24T15:00:00.000Z");

function gate(id: LaunchGateId, status: LaunchGate["status"], reason = "observed"): LaunchGate {
  return makeLaunchGate({ id, status, reason });
}

function internalReadyGates(providerStatus: LaunchGate["status"] = "PENDING", liveStatus: LaunchGate["status"] = "PENDING"): LaunchGate[] {
  return LAUNCH_GATE_IDS.map((id) => {
    if (id === "GATE_14_PROVIDER_ACTIVATION") return gate(id, providerStatus);
    if (id === "GATE_15_LIVE_TEST") return gate(id, liveStatus);
    return gate(id, "PASS");
  });
}

describe("launch readiness", () => {
  it("reports a completely empty system as not ready", () => {
    const result = calculateLaunchReadiness({ now: NOW });
    expect(result.status).toBe("NOT_READY");
    expect(result.score).toBe(0);
    expect(result.missingComponents).toHaveLength(15);
    expect(result.externalProviderPending).toBe(true);
    expect(result.liveTestPending).toBe(true);
  });

  it("keeps internal architecture ready while provider gates remain pending", () => {
    const result = calculateLaunchReadiness({ gates: internalReadyGates(), now: NOW });
    expect(result.status).toBe("CONDITIONALLY_READY");
    expect(result.score).toBe(87);
    expect(result.readyComponents).toHaveLength(13);
    expect(result.gates.find((item) => item.id === "GATE_14_PROVIDER_ACTIVATION")?.status).toBe("PENDING");
    expect(result.gates.find((item) => item.id === "GATE_15_LIVE_TEST")?.status).toBe("PENDING");
  });

  it("does not become live-ready while live testing is pending", () => {
    const result = calculateLaunchReadiness({ gates: internalReadyGates("PASS"), now: NOW });
    expect(result.status).toBe("CONDITIONALLY_READY");
    expect(result.liveTestPending).toBe(true);
  });

  it("becomes live-activation-ready only when every gate passes", () => {
    const result = calculateLaunchReadiness({ gates: internalReadyGates("PASS", "PASS"), now: NOW });
    expect(result.status).toBe("READY_FOR_LIVE_ACTIVATION");
    expect(result.score).toBe(100);
    expect(result.externalProviderPending).toBe(false);
    expect(result.liveTestPending).toBe(false);
  });

  it.each([
    ["GATE_12_SECURITY", "security failure"],
    ["GATE_13_DATA_CLASS", "data-class failure"],
    ["GATE_10_EXECUTION", "approval or execution failure"],
    ["GATE_08_EXPERIMENT", "experiment insufficiency"],
    ["GATE_03_RESEARCH", "research insufficiency"],
  ] as const)("blocks on %s", (id, _label) => {
    const gates = internalReadyGates().map((item) => item.id === id ? gate(item.id, "FAIL") : item);
    const result = calculateLaunchReadiness({ gates, now: NOW });
    expect(result.status).toBe("BLOCKED");
    expect(result.blockers.some((item) => item.startsWith(id))).toBe(true);
  });

  it("is deterministic regardless of input gate order", () => {
    const gates = internalReadyGates();
    const first = calculateLaunchReadiness({ gates, now: NOW });
    const second = calculateLaunchReadiness({ gates: [...gates].reverse(), now: NOW });
    expect(first).toEqual(second);
    expect(first.gates.map((item) => item.id)).toEqual([...LAUNCH_GATE_IDS]);
  });

  it("redacts credentials from gate reasons and required actions", () => {
    const result = calculateLaunchReadiness({
      gates: [makeLaunchGate({ id: "GATE_12_SECURITY", status: "FAIL", reason: "Authorization: Bearer super-secret-token", requiredAction: "token=super-secret-token" })],
      now: NOW,
    });
    expect(result.blockers.join(" ")).not.toContain("super-secret-token");
    expect(result.gates[11].requiredAction).not.toContain("super-secret-token");
  });
});
