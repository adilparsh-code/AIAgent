import "server-only";
import { sanitizeOperationalMessage } from "@/lib/operational-events";

/**
 * Structured server-side logging for important operations:
 * research lifecycle, database errors, agent runs.
 * Never log secrets — only names, ids, statuses and error messages.
 */

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  researchStarted(runId: string, opportunityId: string, providers: string[]) {
    emit("info", "research.started", { runId, opportunityId, providers });
  },
  researchCompleted(runId: string, opportunityId: string, status: string, evidenceCount: number, conclusion: string) {
    emit("info", "research.completed", { runId, opportunityId, status, evidenceCount, conclusion });
  },
  researchFailed(runId: string, opportunityId: string, errors: string[]) {
    emit("error", "research.failed", { runId, opportunityId, errors });
  },
  databaseError(operation: string, message: string) {
    // Message only — never connection strings or credentials.
    emit("error", "database.error", { operation, message });
  },
  agentRunStarted(runId: string, agentId: string, task: string) {
    emit("info", "agentRun.started", { runId, agentId, task });
  },
  agentRunCompleted(runId: string, agentId: string, status: string) {
    emit("info", "agentRun.completed", { runId, agentId, status });
  },
  agentRunFailed(runId: string, agentId: string, errors: string[]) {
    emit("error", "agentRun.failed", { runId, agentId, errors });
  },
  discoveryStarted(runId: string, topic: string, category: string) {
    emit("info", "discovery.started", { runId, topic, category });
  },
  discoveryCompleted(runId: string, status: string, candidateCount: number, readyForHandoffCount: number) {
    emit("info", "discovery.completed", { runId, status, candidateCount, readyForHandoffCount });
  },
  discoveryFailed(runId: string, errors: string[]) {
    emit("error", "discovery.failed", { runId, errors });
  },
  // Phase 8 — integration lifecycle. Only names/statuses/error summaries;
  // never env values, API keys, tokens, or connection strings.
  integrationHealthChecked(adapterName: string, status: string, error: string | null) {
    const level: LogLevel = status === "HEALTHY" || status === "CONFIGURED" || status === "NOT_CONFIGURED" ? "info" : "warn";
    emit(level, "integration.health_checked", { adapterName, status, error });
  },
  integrationExecuted(adapterName: string, action: string, status: string, durationMs: number, ownerId: string) {
    emit("info", "integration.executed", { adapterName, action, status, durationMs, ownerId });
  },
  integrationApprovalRequired(adapterName: string, action: string, capability: string, ownerId: string) {
    emit("warn", "integration.approval_required", { adapterName, action, capability, ownerId });
  },
  operationalEvent(event: { event: string; safeMessage: string; severity: string; executionId?: string; dataClass?: string }) {
    const level: LogLevel = event.severity === "CRITICAL" ? "error" : event.severity === "ERROR" || event.severity === "WARNING" ? "warn" : "info";
    emit(level, `operational.${event.event.toLowerCase()}`, {
      message: sanitizeOperationalMessage(event.safeMessage),
      executionId: event.executionId ?? null,
      dataClass: event.dataClass ?? "UNKNOWN",
    });
  },
};
