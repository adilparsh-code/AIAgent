/**
 * Phase 17 — REAL_DATA provenance gate.
 *
 * Provider output is not REAL_DATA merely because it came from a workflow.
 * Before an observation can influence validation it must have a provider that
 * passed a real health check, a source reference, an observation timestamp, a
 * bounded operation, and a relationship to the current research run. Invalid
 * REAL_LIVE_DATA rows are downgraded, never promoted.
 */

import { sanitizeExternalUrl } from "../evidence-normalization";
import type { Evidence, ResearchRun } from "../research-types";

export interface ProvenanceAuditResult {
  run: ResearchRun;
  acceptedRealDataIds: string[];
  rejectedEvidenceIds: string[];
  reasons: string[];
  realDataCount: number;
}

const PROVIDER_OPERATIONS: Record<string, string> = {
  brave: "SEARCH_WEB",
  "brave-search": "SEARCH_WEB",
  reddit: "SEARCH_POSTS",
  "google-trends": "SEARCH_TRENDS",
};

function hasRealProvenance(
  evidence: Evidence,
  run: ResearchRun,
  healthyProviders: ReadonlySet<string>,
): { ok: true; operation: string } | { ok: false; reason: string } {
  const operation = PROVIDER_OPERATIONS[evidence.source];
  if (!operation) return { ok: false, reason: "provider is not an implemented live research provider" };
  if (!healthyProviders.has(evidence.source)) return { ok: false, reason: "provider has no successful real health check" };
  const status = run.providerStatuses.find((candidate) => candidate.name === evidence.source);
  if (!status || status.status !== "SUCCEEDED") return { ok: false, reason: "provider did not complete successfully" };
  if (!run.id || !evidence.id || !evidence.source) return { ok: false, reason: "research run or evidence relationship is missing" };
  if (!evidence.title.trim() || !evidence.snippet.trim()) return { ok: false, reason: "source observation is not attributable" };
  if (!sanitizeExternalUrl(evidence.url)) return { ok: false, reason: "source URL is missing or invalid" };
  if (Number.isNaN(new Date(evidence.collectedAt).getTime())) return { ok: false, reason: "observation timestamp is missing" };
  return { ok: true, operation };
}

/** Audit and, where necessary, downgrade live-data claims without changing evidence text. */
export function auditRealDataProvenance(
  run: ResearchRun,
  input: { healthyProviders: readonly string[]; now?: Date },
): ProvenanceAuditResult {
  const healthyProviders = new Set(input.healthyProviders);
  const acceptedRealDataIds: string[] = [];
  const rejectedEvidenceIds: string[] = [];
  const reasons: string[] = [];
  const evidence = run.evidence.map((item) => {
    if (item.dataClass !== "REAL_LIVE_DATA") return item;
    const provenance = hasRealProvenance(item, run, healthyProviders);
    if (provenance.ok) {
      acceptedRealDataIds.push(item.id);
      return item;
    }
    rejectedEvidenceIds.push(item.id);
    reasons.push(`${item.id}: ${provenance.reason}`);
    return { ...item, dataClass: "AI_ESTIMATE" as const };
  });
  return {
    run: { ...run, evidence },
    acceptedRealDataIds,
    rejectedEvidenceIds,
    reasons: [...new Set(reasons)],
    realDataCount: acceptedRealDataIds.length,
  };
}

/** True only when a research result contains at least one provenance-complete REAL_DATA item. */
export function containsRealData(run: ResearchRun, healthyProviders: readonly string[]): boolean {
  return auditRealDataProvenance(run, { healthyProviders }).realDataCount > 0;
}
