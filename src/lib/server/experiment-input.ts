import "server-only";
import type { Experiment, ExperimentMetricsRecord } from "../types";

export const MAX_TEXT_LENGTH = 600;
export const MAX_TARGET_LENGTH = 240;
export const MAX_ID_LENGTH = 64;
export const MAX_NUMERIC = 1_000_000_000;
export const MAX_METRIC_ENTRIES = 12;

export const ALLOWED_STATUSES: ReadonlySet<Experiment["status"]> = new Set([
  "PLANNED",
  "READY",
  "RUNNING",
  "ACTIVE",
  "COMPLETED",
  "STOPPED",
  "ITERATING",
  "FAILED",
  "PAUSED",
]);

export const ALLOWED_DECISIONS: ReadonlySet<Experiment["decision"]> = new Set([
  "SCALE",
  "ITERATE",
  "PAUSE",
  "KILL",
  "WIN",
  "STOP",
  "INSUFFICIENT_DATA",
]);

function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clampNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, MAX_NUMERIC);
}

/** Validate a metrics object: only known numeric keys, all non-negative, capped. */
export function sanitizeMetrics(value: unknown): ExperimentMetricsRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: ExperimentMetricsRecord = {};
  const keys = Object.keys(input).slice(0, MAX_METRIC_ENTRIES);
  for (const key of keys) {
    if (!["impressions", "clicks", "visits", "leads", "conversions", "revenue", "cost"].includes(key)) continue;
    const num = clampNonNegativeNumber(input[key]);
    if (num !== null) out[key as keyof ExperimentMetricsRecord] = num;
  }
  return out;
}

/** Validate and clamp a create/update payload. Returns errors instead of throwing. */
export function validateExperimentPayload(body: unknown): {
  ok: boolean;
  errors: string[];
  data?: Partial<Experiment>;
} {
  const errors: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Invalid JSON body"] };
  }
  const input = body as Record<string, unknown>;
  const data: Partial<Experiment> = {};

  if ("hypothesis" in input) {
    const hypothesis = clampText(input.hypothesis, MAX_TEXT_LENGTH);
    if (hypothesis.length < 3) errors.push("hypothesis must be 3-600 characters");
    else data.hypothesis = hypothesis;
  }
  if ("opportunityId" in input) {
    const opportunityId = clampText(input.opportunityId, MAX_ID_LENGTH);
    if (!opportunityId) errors.push("opportunityId must be a non-empty string");
    else data.opportunityId = opportunityId;
  }
  if ("target" in input) {
    const target = clampText(input.target, MAX_TARGET_LENGTH);
    if (!target) errors.push("target must be a non-empty string");
    else data.target = target;
  }
  if ("budget" in input) {
    const budget = clampNonNegativeNumber(input.budget);
    if (budget === null) errors.push("budget must be a non-negative number");
    else data.budget = budget;
  }
  if ("startDate" in input) {
    const date = new Date(String(input.startDate));
    if (Number.isNaN(date.getTime())) errors.push("startDate must be a valid date");
    else data.startDate = date.toISOString();
  }
  if ("status" in input) {
    const status = String(input.status);
    if (!ALLOWED_STATUSES.has(status as Experiment["status"])) errors.push("status is not allowed");
    else data.status = status as Experiment["status"];
  }
  if ("decision" in input) {
    if (input.decision === null) data.decision = null;
    else {
      const decision = String(input.decision);
      if (!ALLOWED_DECISIONS.has(decision as Experiment["decision"])) errors.push("decision is not allowed");
      else data.decision = decision as Experiment["decision"];
    }
  }
  if ("expectedResult" in input) data.expectedResult = clampText(input.expectedResult, MAX_TEXT_LENGTH);
  if ("actualResult" in input) {
    data.actualResult = input.actualResult === null ? null : clampText(input.actualResult, MAX_TEXT_LENGTH);
  }
  if ("objective" in input) data.objective = clampText(input.objective, MAX_TEXT_LENGTH);
  if ("notes" in input) data.notes = clampText(input.notes, MAX_TEXT_LENGTH);
  if ("result" in input) {
    data.result = input.result === null ? null : clampText(input.result, 2_000);
  }
  if ("successCriteria" in input) {
    const criteria = Array.isArray(input.successCriteria) ? input.successCriteria : [];
    if (criteria.length > 20) errors.push("successCriteria must have at most 20 entries");
    else data.successCriteria = criteria.map((c) => clampText(c, 300)).filter(Boolean);
  }
  if ("metrics" in input) {
    if (input.metrics === null) data.metrics = null;
    else {
      const metrics = sanitizeMetrics(input.metrics);
      if (!metrics) errors.push("metrics must be an object with non-negative numeric values");
      else data.metrics = metrics;
    }
  }

  // Legacy flat numeric columns (kept for the existing forms/UI).
  for (const field of ["visitors", "leads", "clicks", "sales"] as const) {
    if (field in input) {
      const num = clampNonNegativeNumber(input[field]);
      if (num === null) errors.push(`${field} must be a non-negative number`);
      else data[field] = Math.round(num);
    }
  }
  for (const field of ["revenue", "profit", "conversionRate"] as const) {
    if (field in input) {
      const num = clampNonNegativeNumber(input[field]);
      if (num === null) errors.push(`${field} must be a non-negative number`);
      else data[field] = num;
    }
  }
  if ("endDate" in input) {
    if (input.endDate === null) data.endDate = null;
    else {
      const date = new Date(String(input.endDate));
      if (Number.isNaN(date.getTime())) errors.push("endDate must be a valid date");
      else data.endDate = date.toISOString();
    }
  }

  return { ok: errors.length === 0, errors, data };
}
