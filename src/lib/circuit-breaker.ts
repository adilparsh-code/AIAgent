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
