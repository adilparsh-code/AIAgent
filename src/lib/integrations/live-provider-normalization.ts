/**
 * Phase 17 — provider-agnostic live result normalization.
 *
 * Pure and side-effect free: it maps the existing IntegrationAdapter /
 * AgentExecution outcomes into a small, sanitized contract. Raw provider output,
 * headers, credentials, and connection strings are never returned.
 */

import { sanitizeErrorMessage } from "./contract";
import { sanitizeOperationalMessage, type OperationalDataClass } from "../operational-events";

export const LIVE_RESULT_STATUSES = [
  "SUCCESS",
  "AUTH_FAILED",
  "CREDIT_LIMITED",
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "EMPTY_RESPONSE",
  "VALIDATION_FAILURE",
  "UNKNOWN_FAILURE",
] as const;

export type LiveResultStatus = (typeof LIVE_RESULT_STATUSES)[number];

export interface NormalizedLiveProviderResult {
  provider: string;
  operation: string;
  success: boolean;
  status: LiveResultStatus;
  latencyMs: number | null;
  resultCount: number | null;
  sanitizedError: string | null;
  dataClass: OperationalDataClass;
  requestId: string;
  executionId: string | null;
}

export interface LiveProviderResultInput {
  provider: string;
  operation: string;
  requestId: string;
  executionId?: string | null;
  status?: string | null;
  success?: boolean;
  latencyMs?: number | null;
  resultCount?: number | null;
  error?: string | null;
  dataClass?: string | null;
  output?: unknown;
}

function statusFromMessage(message: string | null | undefined): LiveResultStatus | null {
  if (!message) return null;
  if (/credit|billing|subscription|payment required|http 402|\b402\b/i.test(message)) return "CREDIT_LIMITED";
  if (/auth|unauthori[sz]ed|forbidden|http 401|http 403|\b401\b|\b403\b/i.test(message)) return "AUTH_FAILED";
  if (/rate.?limit|too many requests|http 429|\b429\b/i.test(message)) return "RATE_LIMITED";
  if (/timeout|timed out|aborted|deadline/i.test(message)) return "TIMEOUT";
  if (/malformed|invalid response|schema|parse/i.test(message)) return "MALFORMED_RESPONSE";
  if (/empty response|no results|result count 0/i.test(message)) return "EMPTY_RESPONSE";
  if (/validation|invalid input|bad request|http 400|\b400\b/i.test(message)) return "VALIDATION_FAILURE";
  if (/unavailable|network|fetch failed|connection refused|http 5\d\d/i.test(message)) return "UNAVAILABLE";
  return null;
}

function countResults(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  for (const key of ["results", "items", "data", "rows"]) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).length;
  }
  return null;
}

/**
 * Normalize an existing execution outcome. A success is REAL_DATA only when
 * the adapter itself declared REAL_DATA and a persisted execution id proves the
 * call passed through the controlled execution boundary.
 */
export function normalizeLiveProviderResult(input: LiveProviderResultInput): NormalizedLiveProviderResult {
  const rawStatus = String(input.status ?? "").toUpperCase();
  const rawError = input.error ? sanitizeErrorMessage(sanitizeOperationalMessage(input.error)) : null;
  const resultCount = input.resultCount ?? countResults(input.output);
  const succeeded = input.success === true || rawStatus === "SUCCEEDED" || rawStatus === "SUCCESS";

  let status: LiveResultStatus;
  if (succeeded && resultCount === 0) status = "EMPTY_RESPONSE";
  else if (succeeded) status = "SUCCESS";
  else if (rawStatus === "TIMEOUT") status = "TIMEOUT";
  else if (rawStatus === "RATE_LIMITED") status = "RATE_LIMITED";
  else if (rawStatus === "AUTH_FAILED") status = "AUTH_FAILED";
  else if (rawStatus === "UNAVAILABLE" || rawStatus === "BLOCKED") status = "UNAVAILABLE";
  else if (rawStatus === "VALIDATION_FAILURE" || rawStatus === "REJECTED") status = "VALIDATION_FAILURE";
  else status = statusFromMessage(rawError ?? rawStatus) ?? "UNKNOWN_FAILURE";

  const success = status === "SUCCESS";
  const declaredReal = String(input.dataClass ?? "").toUpperCase() === "REAL_DATA";
  const dataClass: OperationalDataClass = success && declaredReal && input.executionId
    ? "REAL_DATA"
    : success && String(input.dataClass ?? "").toUpperCase().includes("AI")
      ? "AI_ESTIMATE"
      : success
        ? "UNKNOWN"
        : "UNKNOWN";

  return {
    provider: String(input.provider ?? "unknown").slice(0, 80),
    operation: String(input.operation ?? "UNKNOWN").slice(0, 80),
    success,
    status,
    latencyMs: Number.isFinite(input.latencyMs) && Number(input.latencyMs) >= 0
      ? Math.round(Number(input.latencyMs))
      : null,
    resultCount: Number.isFinite(resultCount) && Number(resultCount) >= 0 ? Math.floor(Number(resultCount)) : null,
    sanitizedError: success ? null : rawError ? sanitizeOperationalMessage(rawError) : "Provider operation failed without a safe diagnostic.",
    dataClass,
    requestId: String(input.requestId ?? "unknown").slice(0, 96),
    executionId: input.executionId ? String(input.executionId).slice(0, 96) : null,
  };
}
