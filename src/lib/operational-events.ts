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
  [/(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]"],
  [/(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|pwd|secret|token|session(?:[_-]?id)?|auth)\s*[:=]\s*"?[^\s,;"']+"?/gi, "[REDACTED]"],
  [/\b(?:sk|pk|rk|key|token|bearer|sess)-[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{12,}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, "[REDACTED]"],
  [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|clickhouse):\/\/[^\s"']+/gi, "[REDACTED_CONNECTION_STRING]"],
  [/\b[A-Za-z0-9._%+-]+:[^\s@/]+@[A-Za-z0-9.-]+:\d+/g, "[REDACTED_CONNECTION_STRING]"],
];

/** Redact common credential shapes and cap the message; never log raw input. */
export function sanitizeOperationalMessage(message: string): string {
  let safe = String(message ?? "").replace(/[\r\n]+/g, " ").slice(0, 500);
  for (const [pattern, replacement] of SECRET_PATTERNS) safe = safe.replace(pattern, replacement);
  return safe.trim() || "Operation completed without a safe diagnostic message.";
}

const MAX_LOG_STRING_LENGTH = 500;
const MAX_LOG_ARRAY_ITEMS = 25;
const MAX_LOG_DEPTH = 3;

function isPlainLogValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * HIGH-7: recursively sanitize any value on its way into a centralized log.
 *
 * The logger must not depend on every call site remembering to sanitize: a raw
 * `error.message` can carry a connection string, an API key or a bearer token,
 * and structured log sinks retain it. Strings are redacted and length-capped,
 * arrays are bounded, and nesting is depth-limited so a hostile or cyclic
 * object cannot flood or crash the sink. Non-string scalars are preserved.
 */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeOperationalMessage(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeOperationalMessage(value.message) };
  }
  if (depth >= MAX_LOG_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_LOG_ARRAY_ITEMS).map((item) => sanitizeLogValue(item, depth + 1));
    return value.length > MAX_LOG_ARRAY_ITEMS
      ? [...items, `[+${value.length - MAX_LOG_ARRAY_ITEMS} more]`]
      : items;
  }
  if (isPlainLogValue(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sanitizeLogValue(nested, depth + 1);
    }
    return output;
  }
  return sanitizeOperationalMessage(String(value));
}

/** Sanitize every field of a structured log record, centrally. */
export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    output[key.slice(0, 80)] = sanitizeLogValue(value);
  }
  return output;
}

export { MAX_LOG_STRING_LENGTH };

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
