/** Phase 14 — pure operational event model. Messages are sanitized before storage/display. */

export const OPERATIONAL_EVENT_CATEGORIES = [
  "RESEARCH",
  "VALIDATION",
  "EXPERIMENT",
  "LEARNING",
  "FEEDBACK",
  "HANDOFF",
  "EXECUTION",
  "AUTH",
  "INTEGRATION",
  "AGENT_RUNTIME",
  "SYSTEM",
] as const;
export type OperationalEventCategory = (typeof OPERATIONAL_EVENT_CATEGORIES)[number];

export const OPERATIONAL_EVENT_SEVERITIES = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;
export type OperationalEventSeverity = (typeof OPERATIONAL_EVENT_SEVERITIES)[number];
export type OperationalDataClass = "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA" | "ESTIMATED_DATA" | "UNKNOWN";

export interface OperationalEvent {
  category: OperationalEventCategory;
  severity: OperationalEventSeverity;
  event: string;
  safeMessage: string;
  timestamp: string;
  opportunityId?: string;
  taskId?: string;
  executionId?: string;
  dataClass: OperationalDataClass;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]"],
  [/(?:authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]"],
  [/(?:api[_-]?key|password|secret|token|session)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]"],
  [/\b(?:sk|pk|key|token)-[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]"],
  [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, "[REDACTED_CONNECTION_STRING]"],
];

/** Redact common credential shapes and cap the message; never log raw input. */
export function sanitizeOperationalMessage(message: string): string {
  let safe = String(message ?? "").replace(/[\r\n]+/g, " ").slice(0, 500);
  for (const [pattern, replacement] of SECRET_PATTERNS) safe = safe.replace(pattern, replacement);
  return safe.trim() || "Operation completed without a safe diagnostic message.";
}

export function createOperationalEvent(input: Omit<OperationalEvent, "safeMessage" | "timestamp"> & { safeMessage: string; timestamp?: Date | string }): OperationalEvent {
  const timestamp = input.timestamp instanceof Date
    ? input.timestamp
    : input.timestamp
      ? new Date(input.timestamp)
      : new Date();
  return {
    category: input.category,
    severity: input.severity,
    event: String(input.event).slice(0, 120),
    safeMessage: sanitizeOperationalMessage(input.safeMessage),
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString(),
    ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    dataClass: input.dataClass,
  };
}
