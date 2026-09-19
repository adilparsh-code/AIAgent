import "server-only";

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
};
