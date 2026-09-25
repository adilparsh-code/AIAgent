/** Phase 20 — bounded in-memory circuit breaker for repeated component failures. */
import type { FailureCategory } from "@/lib/failure-classification";

export const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 3,
  cooldownMs: 15 * 60 * 1000,
} as const;

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerRecord {
  component: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAt: string | null;
  retryAt: string | null;
  lastFailureCategory: FailureCategory | null;
  lastFailureAt: string | null;
}

export interface CircuitBreakerSnapshot {
  records: Record<string, CircuitBreakerRecord>;
  openComponents: string[];
  updatedAt: string;
}

function emptyRecord(component: string): CircuitBreakerRecord {
  return {
    component,
    state: "CLOSED",
    consecutiveFailures: 0,
    openedAt: null,
    retryAt: null,
    lastFailureCategory: null,
    lastFailureAt: null,
  };
}

function clone(snapshot: CircuitBreakerSnapshot): CircuitBreakerSnapshot {
  return {
    records: Object.fromEntries(Object.entries(snapshot.records).map(([key, value]) => [key, { ...value }])),
    openComponents: [...snapshot.openComponents],
    updatedAt: snapshot.updatedAt,
  };
}

export function createCircuitBreakerSnapshot(now = new Date()): CircuitBreakerSnapshot {
  return { records: {}, openComponents: [], updatedAt: now.toISOString() };
}

export function isCircuitOpen(snapshot: CircuitBreakerSnapshot, component: string, now = new Date()): boolean {
  const record = snapshot.records[component];
  if (!record) return false;
  if (record.state !== "OPEN") return false;
  if (record.retryAt && new Date(record.retryAt).getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

export function recordCircuitSuccess(
  snapshot: CircuitBreakerSnapshot,
  component: string,
  now = new Date(),
): CircuitBreakerSnapshot {
  const next = clone(snapshot);
  next.records[component] = {
    ...(next.records[component] ?? emptyRecord(component)),
    state: "CLOSED",
    consecutiveFailures: 0,
    openedAt: null,
    retryAt: null,
  };
  next.openComponents = next.openComponents.filter((name) => name !== component);
  next.updatedAt = now.toISOString();
  return next;
}

export function recordCircuitFailure(
  snapshot: CircuitBreakerSnapshot,
  component: string,
  category: FailureCategory,
  now = new Date(),
  options: { failureThreshold?: number; cooldownMs?: number } = {},
): CircuitBreakerSnapshot {
  const next = clone(snapshot);
  const previous = next.records[component] ?? emptyRecord(component);
  const threshold = Math.max(1, Math.floor(options.failureThreshold ?? CIRCUIT_BREAKER_DEFAULTS.failureThreshold));
  const cooldown = Math.max(0, Math.floor(options.cooldownMs ?? CIRCUIT_BREAKER_DEFAULTS.cooldownMs));
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldOpen = consecutiveFailures >= threshold;
  next.records[component] = {
    ...previous,
    state: shouldOpen ? "OPEN" : previous.state === "OPEN" ? "HALF_OPEN" : "CLOSED",
    consecutiveFailures,
    openedAt: shouldOpen ? now.toISOString() : previous.openedAt,
    retryAt: shouldOpen ? new Date(now.getTime() + cooldown).toISOString() : null,
    lastFailureCategory: category,
    lastFailureAt: now.toISOString(),
  };
  next.openComponents = Object.keys(next.records)
    .filter((name) => next.records[name].state === "OPEN")
    .sort();
  next.updatedAt = now.toISOString();
  return next;
}

// ---------------------------------------------------------------------------
// MEDIUM-7 — cross-cycle circuit state
//
// A circuit breaker that is rebuilt from empty at the start of every call can
// never open: the failure threshold is only ever reached within a single call,
// so a component that fails on every cycle was retried forever. The operations
// service therefore had no working breaker at all.
//
// The snapshot is kept per owner in a bounded, process-local registry so the
// next cycle continues from the previous verdict. Limitation, stated honestly:
// this is process memory, so a restart — or a second application instance —
// starts from a closed circuit again. That is strictly better than resetting
// every call, and it is NOT presented as a distributed breaker. Per-owner
// isolation is preserved because the registry key is the owner id.
// ---------------------------------------------------------------------------

const MAX_TRACKED_SNAPSHOTS = 500;
const SNAPSHOT_RETENTION_MS = CIRCUIT_BREAKER_DEFAULTS.cooldownMs * 4;

const snapshotRegistry = new Map<string, CircuitBreakerSnapshot>();

function pruneSnapshots(now: number): void {
  for (const [key, snapshot] of snapshotRegistry) {
    const updatedAt = new Date(snapshot.updatedAt).getTime();
    if (Number.isNaN(updatedAt) || now - updatedAt > SNAPSHOT_RETENTION_MS) snapshotRegistry.delete(key);
  }
  // Hard bound: if everything is fresh, drop the oldest entry rather than grow.
  while (snapshotRegistry.size > MAX_TRACKED_SNAPSHOTS) {
    const oldest = snapshotRegistry.keys().next();
    if (oldest.done) break;
    snapshotRegistry.delete(oldest.value);
  }
}

/** Read the circuit state carried over from the previous cycle for `ownerId`. */
export function readCircuitBreakerSnapshot(ownerId: string, now = new Date()): CircuitBreakerSnapshot {
  pruneSnapshots(now.getTime());
  return snapshotRegistry.get(ownerId) ?? createCircuitBreakerSnapshot(now);
}

/** Persist the circuit state produced by this cycle for the next one. */
export function writeCircuitBreakerSnapshot(ownerId: string, snapshot: CircuitBreakerSnapshot): void {
  pruneSnapshots(new Date(snapshot.updatedAt).getTime() || Date.now());
  snapshotRegistry.set(ownerId, snapshot);
}

/** Test/reset helper. */
export function resetCircuitBreakerSnapshots(): void {
  snapshotRegistry.clear();
}
