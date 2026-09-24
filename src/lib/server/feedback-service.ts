import "server-only";

import { getPrisma } from "@/lib/db";
import { logger } from "@/lib/server/logger";
import { metricRepository } from "@/lib/server/repositories/metrics";
import {
  canFetchFeedback,
  validateFeedbackMetricRecord,
  type ExternalFeedbackAdapter,
  type ExternalFeedbackResult,
  type FeedbackMetricRecord,
  type FeedbackProviderStatus,
} from "@/lib/feedback-contract";

export interface FeedbackBoundaryView {
  experimentId: string;
  provider: string;
  status: FeedbackProviderStatus;
  statusLabel: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" | "AUTH_FAILED" | "FAILED" | "DISABLED";
  message: string;
  checkedAt: string | null;
  recordsAvailable: boolean;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED" | "UNKNOWN";
}

/**
 * Phase 21 — the AIAgent boundary for feedback from AI Income Lab or an
 * external feedback provider. No provider is bundled or hard-coded: callers
 * must inject an adapter, and only a real HEALTHY check permits a fetch.
 */
export async function getFeedbackBoundary(
  experimentId: string,
  ownerId: string,
  adapter?: ExternalFeedbackAdapter,
): Promise<FeedbackBoundaryView | null> {
  const experiment = await getPrisma().experiment.findFirst({
    where: { id: experimentId, isSample: false, opportunity: { ownerId } },
    select: { id: true },
  });
  if (!experiment) return null;
  if (!adapter) {
    return {
      experimentId,
      provider: "none",
      status: "NOT_CONFIGURED",
      statusLabel: "NOT_CONFIGURED",
      message: "External feedback provider unavailable/not configured.",
      checkedAt: null,
      recordsAvailable: false,
      dataClass: "NOT_MEASURED",
    };
  }
  const health = await adapter.healthCheck();
  return {
    experimentId,
    provider: adapter.name,
    status: health.status,
    statusLabel: health.status === "HEALTHY" ? "READY" : health.status,
    message: health.safeMessage,
    checkedAt: health.checkedAt,
    recordsAvailable: canFetchFeedback(health.status),
    dataClass: "UNKNOWN",
  };
}

function toMetricInput(record: FeedbackMetricRecord) {
  return {
    recordedAt: new Date(),
    periodStart: new Date(record.periodStart),
    periodEnd: new Date(record.periodEnd),
    impressions: record.impressions ?? null,
    clicks: record.clicks ?? null,
    visits: record.visits ?? null,
    leads: record.leads ?? null,
    conversions: record.conversions ?? null,
    revenue: record.revenue ?? null,
    cost: record.cost ?? null,
    currency: record.currency ?? "USD",
    source: record.source,
    // The existing ExperimentMetric model deliberately supports only these
    // two persisted measurement classes. NOT_MEASURED/UNKNOWN are returned
    // to the caller but never converted into a fake measurement.
    dataClass: record.dataClass as "REAL_DATA" | "ESTIMATED_DATA",
    notes: `${record.externalId}${record.notes ? ` · ${record.notes}` : ""}`.slice(0, 500),
  };
}

/**
 * Fetch and append provider feedback. Missing or unavailable feedback is a
 * truthful blocked result. Records are validated before persistence, duplicate
 * external IDs are collapsed per response, and the existing metric uniqueness
 * constraint makes repeated ingestion safe.
 */
export async function ingestExternalFeedback(input: {
  experimentId: string;
  ownerId: string;
  adapter?: ExternalFeedbackAdapter;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  status: "INGESTED" | "DUPLICATE" | "NOT_CONFIGURED" | "UNAVAILABLE" | "AUTH_FAILED" | "FAILED" | "INVALID";
  boundary: FeedbackBoundaryView | null;
  accepted: number;
  duplicates: number;
  rejected: Array<{ externalId: string; errors: string[] }>;
  message: string;
}> {
  const boundary = await getFeedbackBoundary(input.experimentId, input.ownerId, input.adapter);
  if (!boundary) {
    return { ok: false, status: "NOT_CONFIGURED", boundary: null, accepted: 0, duplicates: 0, rejected: [], message: "Experiment not found." };
  }
  if (!input.adapter || boundary.status !== "HEALTHY") {
    return { ok: false, status: boundary.status === "AUTH_FAILED" ? "AUTH_FAILED" : boundary.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE", boundary, accepted: 0, duplicates: 0, rejected: [], message: boundary.message };
  }

  const result: ExternalFeedbackResult = await input.adapter.fetchFeedback({
    ownerId: input.ownerId,
    experimentId: input.experimentId,
    idempotencyKey: input.idempotencyKey ?? `feedback:${input.ownerId}:${input.experimentId}`,
  });
  if (result.status !== "AVAILABLE") {
    return { ok: false, status: result.status === "AUTH_FAILED" ? "AUTH_FAILED" : result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE", boundary: { ...boundary, message: result.safeMessage, checkedAt: result.checkedAt }, accepted: 0, duplicates: 0, rejected: [], message: result.safeMessage };
  }

  const rejected: Array<{ externalId: string; errors: string[] }> = [];
  const valid: FeedbackMetricRecord[] = [];
  const seen = new Set<string>();
  for (const raw of result.records) {
    if (seen.has(raw.externalId)) {
      continue;
    }
    seen.add(raw.externalId);
    const checked = validateFeedbackMetricRecord(raw);
    if (!checked.ok) {
      rejected.push({ externalId: raw.externalId, errors: checked.errors });
      continue;
    }
    if (checked.record.dataClass !== "REAL_DATA" && checked.record.dataClass !== "ESTIMATED_DATA") {
      rejected.push({ externalId: raw.externalId, errors: ["record is not a persisted measurement class; no metric was created"] });
      continue;
    }
    valid.push(checked.record);
  }

  let accepted = 0;
  let duplicates = 0;
  for (const record of valid) {
    try {
      await metricRepository.createForOwner(input.experimentId, input.ownerId, toMetricInput(record), input.ownerId);
      accepted += 1;
    } catch (error) {
      if (error instanceof Error && (error.message.includes("Unique constraint") || error.message.includes("P2002"))) {
        duplicates += 1;
        continue;
      }
      throw error;
    }
  }
  const message = accepted > 0
    ? `Recorded ${accepted} provider feedback measurement(s).`
    : duplicates > 0
      ? `Feedback already recorded; no duplicate metric was created.`
      : "Provider returned no persistable measurement records.";
  logger.operationalEvent({
    event: "FEEDBACK_INGESTED",
    safeMessage: `Feedback boundary processed ${accepted} record(s); ${duplicates} duplicate(s) skipped.`,
    severity: accepted > 0 ? "INFO" : "WARNING",
    dataClass: valid.some((record) => record.dataClass === "REAL_DATA") ? "REAL_DATA" : "ESTIMATED_DATA",
  });
  return { ok: rejected.length === 0, status: accepted > 0 || duplicates > 0 ? (duplicates > 0 && accepted === 0 ? "DUPLICATE" : "INGESTED") : "INVALID", boundary, accepted, duplicates, rejected, message };
}
