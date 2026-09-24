import type { MetricDataClass } from "@prisma/client";

/**
 * Phase 6B — server-side validation for time-series metric records.
 *
 * Principles:
 * - No silent coercion: a malformed value is a 4xx, never a guessed number.
 * - Missing fields stay missing (absent → NULL in the database).
 * - Explicit zeros are real measurements and are preserved as zeros.
 * - Non-finite numbers (NaN/Infinity) and negatives are rejected outright.
 */

export const MAX_METRIC_NOTE_LENGTH = 500;
export const MAX_METRIC_SOURCE_LENGTH = 120;
export const MAX_METRIC_CURRENCY_LENGTH = 8;
export const MAX_METRIC_NUMERIC = 1_000_000_000_000;

export interface ExperimentMetricInput {
  recordedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  impressions: number | null;
  clicks: number | null;
  visits: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
  cost: number | null;
  currency: string;
  source: string;
  dataClass: MetricDataClass;
  notes: string;
}

export interface ValidatedMetricInput {
  ok: boolean;
  errors: string[];
  data?: ExperimentMetricInput;
}

const COUNT_FIELDS = ["impressions", "clicks", "visits", "leads", "conversions"] as const;
const MONEY_FIELDS = ["revenue", "cost"] as const;

/** Strict count validation: integers only, non-negative, finite, bounded. */
function parseCount(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null; // absent = missing
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > MAX_METRIC_NUMERIC) return undefined;
  return value;
}

/** Strict money validation: finite, non-negative, bounded. Fractional cents are rejected. */
function parseMoney(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > MAX_METRIC_NUMERIC) return undefined;
  if (Math.round(value * 100) !== value * 100) return undefined;
  return value;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // Guard against absurd ranges (year 0–9999 only).
  if (date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 9999) return undefined;
  return date;
}

function parseDataClass(value: unknown): MetricDataClass | undefined {
  return value === "REAL_DATA" || value === "ESTIMATED_DATA" ? value : undefined;
}

function parseCurrency(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return "USD";
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toUpperCase().slice(0, MAX_METRIC_CURRENCY_LENGTH);
  // ISO-4217-ish shape: three letters. No silent coercion of junk.
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Validate a metric-record payload. Absent optional numeric keys are valid and
 * mean "not measured"; present-but-malformed values are errors, never coerced.
 */
export function validateMetricPayload(body: unknown): ValidatedMetricInput {
  const errors: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Invalid JSON body"] };
  }
  const input = body as Record<string, unknown>;

  const periodStart = parseDate(input.periodStart);
  if (!periodStart) errors.push("periodStart must be a valid ISO timestamp");
  const periodEnd = parseDate(input.periodEnd);
  if (!periodEnd) errors.push("periodEnd must be a valid ISO timestamp");
  if (periodStart && periodEnd && periodEnd.getTime() < periodStart.getTime()) {
    errors.push("periodEnd must be greater than or equal to periodStart");
  }

  // recordedAt defaults to now only when absent; a provided value must be valid.
  let recordedAt: Date;
  if (input.recordedAt === undefined) {
    recordedAt = new Date();
  } else {
    const parsed = parseDate(input.recordedAt);
    if (!parsed) {
      errors.push("recordedAt must be a valid ISO timestamp");
      recordedAt = new Date(0);
    } else {
      recordedAt = parsed;
    }
  }

  const data: ExperimentMetricInput = {
    recordedAt,
    periodStart: periodStart ?? new Date(0),
    periodEnd: periodEnd ?? new Date(0),
    impressions: null,
    clicks: null,
    visits: null,
    leads: null,
    conversions: null,
    revenue: null,
    cost: null,
    currency: "USD",
    source: "",
    dataClass: "ESTIMATED_DATA",
    notes: "",
  };

  for (const field of COUNT_FIELDS) {
    if (field in input) {
      const parsed = parseCount(input[field]);
      if (parsed === undefined) {
        errors.push(`${field} must be a non-negative integer when provided`);
      } else {
        data[field] = parsed;
      }
    }
  }
  for (const field of MONEY_FIELDS) {
    if (field in input) {
      const parsed = parseMoney(input[field]);
      if (parsed === undefined) {
        errors.push(`${field} must be a non-negative number with at most 2 decimals when provided`);
      } else {
        data[field] = parsed;
      }
    }
  }

  const currency = parseCurrency(input.currency);
  if (currency === undefined) errors.push("currency must be a 3-letter ISO code when provided");
  else data.currency = currency;

  const dataClass = parseDataClass(input.dataClass);
  if (dataClass === undefined) errors.push("dataClass must be explicitly REAL_DATA or ESTIMATED_DATA");
  else data.dataClass = dataClass;

  if (input.source !== undefined) {
    if (typeof input.source !== "string") errors.push("source must be a string");
    else data.source = input.source.trim().slice(0, MAX_METRIC_SOURCE_LENGTH);
  }
  if (errors.length === 0 && data.dataClass === "REAL_DATA" && !data.source) {
    errors.push("REAL_DATA requires a non-empty source describing the permitted measurement origin");
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== "string") errors.push("notes must be a string");
    else data.notes = input.notes.trim().slice(0, MAX_METRIC_NOTE_LENGTH);
  }

  // At least one measurement must be present — an empty record is meaningless.
  const hasAnyMeasurement = COUNT_FIELDS.some((f) => data[f] !== null) || MONEY_FIELDS.some((f) => data[f] !== null);
  if (errors.length === 0 && !hasAnyMeasurement) {
    errors.push("at least one metric value (impressions, clicks, visits, leads, conversions, revenue, or cost) is required");
  }

  return { ok: errors.length === 0, errors, data: errors.length === 0 ? data : undefined };
}

/** Validate `from`/`to` query filters. Returns undefined values when absent. */
export function validateMetricRange(searchParams: URLSearchParams): {
  ok: boolean;
  error?: string;
  from?: Date;
  to?: Date;
} {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromRaw) {
    from = parseDate(fromRaw);
    if (!from) return { ok: false, error: "from must be a valid ISO timestamp" };
  }
  if (toRaw) {
    to = parseDate(toRaw);
    if (!to) return { ok: false, error: "to must be a valid ISO timestamp" };
  }
  if (from && to && to.getTime() < from.getTime()) {
    return { ok: false, error: "to must be greater than or equal to from" };
  }
  return { ok: true, from, to };
}
