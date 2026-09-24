/**
 * Phase 21 — external feedback boundary.
 *
 * AI Income Lab may later connect an analytics/customer-feedback provider, but
 * AIAgent must not assume that provider exists. This contract is deliberately
 * provider-neutral: adapters return data with provenance and the ingestion
 * layer decides whether it is safe to persist.
 */
export const FEEDBACK_PROVIDER_STATUSES = [
  "HEALTHY",
  "NOT_CONFIGURED",
  "UNAVAILABLE",
  "AUTH_FAILED",
  "DISABLED",
  "FAILED",
] as const;
export type FeedbackProviderStatus = (typeof FEEDBACK_PROVIDER_STATUSES)[number];

export type FeedbackDataClass = "REAL_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED" | "UNKNOWN";

export interface FeedbackMetricRecord {
  externalId: string;
  experimentId: string;
  periodStart: string;
  periodEnd: string;
  impressions?: number | null;
  clicks?: number | null;
  visits?: number | null;
  leads?: number | null;
  conversions?: number | null;
  revenue?: number | null;
  cost?: number | null;
  currency?: string;
  source: string;
  dataClass: FeedbackDataClass;
  notes?: string;
}

export interface ExternalFeedbackResult {
  status: "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE" | "AUTH_FAILED" | "FAILED";
  safeMessage: string;
  records: FeedbackMetricRecord[];
  provider: string;
  checkedAt: string;
}

export interface ExternalFeedbackAdapter {
  readonly name: string;
  /** Must reflect a real health/authentication check, not mere configuration. */
  healthCheck(): Promise<{ status: FeedbackProviderStatus; checkedAt: string; safeMessage: string }>;
  fetchFeedback(input: { ownerId: string; experimentId: string; idempotencyKey: string }): Promise<ExternalFeedbackResult>;
}

const MAX_EXTERNAL_ID = 200;
const MAX_SOURCE = 120;
const MAX_NOTES = 500;
const COUNT_FIELDS = ["impressions", "clicks", "visits", "leads", "conversions"] as const;
const MONEY_FIELDS = ["revenue", "cost"] as const;

function isValidDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 1970 && date.getUTCFullYear() <= 9999;
}

function validNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/** Validate and bound one external record without changing its data class. */
export function validateFeedbackMetricRecord(input: FeedbackMetricRecord): { ok: true; record: FeedbackMetricRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const externalId = input.externalId.trim().slice(0, MAX_EXTERNAL_ID);
  const source = input.source.trim().slice(0, MAX_SOURCE);
  if (!externalId) errors.push("externalId is required");
  if (!input.experimentId.trim()) errors.push("experimentId is required");
  if (!isValidDate(input.periodStart)) errors.push("periodStart must be a valid ISO timestamp");
  if (!isValidDate(input.periodEnd)) errors.push("periodEnd must be a valid ISO timestamp");
  if (isValidDate(input.periodStart) && isValidDate(input.periodEnd) && new Date(input.periodEnd) < new Date(input.periodStart)) {
    errors.push("periodEnd must not precede periodStart");
  }
  if (!source) errors.push("source is required");
  if (!["REAL_DATA", "ESTIMATED_DATA", "NOT_MEASURED", "UNKNOWN"].includes(input.dataClass)) errors.push("dataClass is invalid");
  if (input.dataClass === "REAL_DATA" && !source) errors.push("REAL_DATA requires source provenance");
  for (const key of [...COUNT_FIELDS, ...MONEY_FIELDS]) if (!validNumber(input[key])) errors.push(`${key} must be non-negative and finite`);
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) errors.push("currency must be an uppercase three-letter code");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    record: {
      ...input,
      externalId,
      source,
      currency: input.currency ?? "USD",
      notes: (input.notes ?? "").slice(0, MAX_NOTES),
    },
  };
}

/** A provider is eligible for external calls only after a real HEALTHY check. */
export function canFetchFeedback(status: FeedbackProviderStatus): boolean {
  return status === "HEALTHY";
}
