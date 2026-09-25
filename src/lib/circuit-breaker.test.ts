import { afterEach, describe, expect, it } from "vitest";
import {
  CIRCUIT_BREAKER_DEFAULTS,
  createCircuitBreakerSnapshot,
  isCircuitOpen,
  readCircuitBreakerSnapshot,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuitBreakerSnapshots,
  writeCircuitBreakerSnapshot,
} from "./circuit-breaker";

/**
 * MEDIUM-7 — the operations service never supplied a circuit-breaker
 * snapshot, so `runAutonomousOperationsCycle` built a fresh one on every call.
 * A component failing on every cycle could therefore never reach the failure
 * threshold that opens the breaker: the breaker was inert.
 */
describe("circuit breaker cross-cycle state", () => {
  afterEach(() => resetCircuitBreakerSnapshots());

  it("starts closed for an owner with no recorded state", () => {
    const snapshot = readCircuitBreakerSnapshot("owner-1");
    expect(snapshot.records).toEqual({});
    expect(isCircuitOpen(snapshot, "sambanova")).toBe(false);
  });

  it("carries accumulated failures from one cycle into the next", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const t1 = new Date("2026-01-01T00:05:00.000Z");

    // Cycle 1: two failures, still under the threshold.
    const afterFirst = recordCircuitFailure(readCircuitBreakerSnapshot("owner-1", t0), "sambanova", "PROVIDER_UNAVAILABLE", t0);
    writeCircuitBreakerSnapshot("owner-1", afterFirst);
    const afterSecond = recordCircuitFailure(readCircuitBreakerSnapshot("owner-1", t1), "sambanova", "PROVIDER_UNAVAILABLE", t1);
    writeCircuitBreakerSnapshot("owner-1", afterSecond);
    expect(afterSecond.records.sambanova?.consecutiveFailures).toBe(2);
    expect(isCircuitOpen(afterSecond, "sambanova", t1)).toBe(false);

    // Cycle 3: the third consecutive failure crosses the threshold and the
    // breaker is now genuinely open — which the old per-call reset could
    // never reach.
    const afterThird = recordCircuitFailure(readCircuitBreakerSnapshot("owner-1", t1), "sambanova", "PROVIDER_UNAVAILABLE", t1);
    writeCircuitBreakerSnapshot("owner-1", afterThird);
    expect(afterThird.records.sambanova?.state).toBe("OPEN");
    expect(isCircuitOpen(afterThird, "sambanova", t1)).toBe(true);
    expect(afterThird.openComponents).toContain("sambanova");
  });

  it("keeps owners isolated from each other", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    writeCircuitBreakerSnapshot(
      "owner-1",
      recordCircuitFailure(createCircuitBreakerSnapshot(t0), "sambanova", "PROVIDER_UNAVAILABLE", t0),
    );
    expect(readCircuitBreakerSnapshot("owner-2", t0).records).toEqual({});
  });

  it("closes again after a recorded success", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const opened = recordCircuitFailure(
      recordCircuitFailure(
        recordCircuitFailure(createCircuitBreakerSnapshot(t0), "sambanova", "PROVIDER_UNAVAILABLE", t0),
        "sambanova",
        "PROVIDER_UNAVAILABLE",
        t0,
      ),
      "sambanova",
      "PROVIDER_UNAVAILABLE",
      t0,
    );
    const closed = recordCircuitSuccess(opened, "sambanova", t0);
    writeCircuitBreakerSnapshot("owner-1", closed);
    expect(readCircuitBreakerSnapshot("owner-1", t0).records.sambanova?.state).toBe("CLOSED");
  });

  it("honours the cooldown window rather than reopening immediately", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const opened = recordCircuitFailure(
      recordCircuitFailure(
        recordCircuitFailure(createCircuitBreakerSnapshot(t0), "sambanova", "PROVIDER_UNAVAILABLE", t0),
        "sambanova",
        "PROVIDER_UNAVAILABLE",
        t0,
      ),
      "sambanova",
      "PROVIDER_UNAVAILABLE",
      t0,
    );
    writeCircuitBreakerSnapshot("owner-1", opened);
    const afterCooldown = new Date(t0.getTime() + CIRCUIT_BREAKER_DEFAULTS.cooldownMs + 1);
    expect(isCircuitOpen(readCircuitBreakerSnapshot("owner-1", afterCooldown), "sambanova", afterCooldown)).toBe(false);
  });

  it("bounds the registry and drops a stale entry", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const stale = new Date(t0.getTime() + CIRCUIT_BREAKER_DEFAULTS.cooldownMs * 8);
    writeCircuitBreakerSnapshot(
      "owner-stale",
      recordCircuitFailure(createCircuitBreakerSnapshot(t0), "sambanova", "PROVIDER_UNAVAILABLE", t0),
    );
    // A later read prunes entries older than the retention window.
    expect(readCircuitBreakerSnapshot("owner-fresh", stale).records).toEqual({});
    writeCircuitBreakerSnapshot("owner-stale", readCircuitBreakerSnapshot("owner-stale", stale));
    expect(readCircuitBreakerSnapshot("owner-stale", stale).records).toEqual({});
  });
});
