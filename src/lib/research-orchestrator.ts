import { getResearchProviders, isProviderNotConfigured } from "./research-providers";
import { dedupeEvidence, normalizeEvidenceItem } from "./evidence-normalization";
import { buildConclusion, buildScoreIntegration, buildValidationSignals, countContradictions } from "./validation";
import type { ResearchProvider } from "./base-provider";
import type {
  Evidence,
  ProviderRunStatus,
  ResearchFinding,
  ResearchQuery,
  ResearchRun,
  ResearchProviderName,
} from "./research-types";

function runId() {
  return `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Already-normalized Evidence passes through; only raw/malformed rows are re-normalized. */
function isPreNormalizedEvidence(row: unknown): row is Evidence {
  if (!row || typeof row !== "object") return false;
  const candidate = row as Partial<Evidence>;
  return (
    typeof candidate.id === "string" && candidate.id.length > 0 &&
    typeof candidate.hash === "string" && candidate.hash.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.url === "string" && /^https?:\/\//i.test(candidate.url)
  );
}

function makeQueries(title: string): ResearchQuery[] {
  return [
    { query: `${title} demand market`, source: "brave", purpose: "demand" },
    { query: `${title} people want problems`, source: "reddit", purpose: "pain-point" },
    { query: `${title} alternatives pricing`, source: "brave", purpose: "commercial-intent" },
    { query: `${title} competitors market size`, source: "brave", purpose: "competition" },
    { query: `${title}`, source: "google-trends", purpose: "trend" },
  ];
}

function buildFindings(evidence: Evidence[]): ResearchFinding[] {
  if (!evidence.length) return [];
  const grouped = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = item.supports[0] ?? "market";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return Array.from(grouped.entries()).map(([purpose, items], index) => ({
    id: `finding-${index + 1}-${purpose}`,
    claim: `${purpose} evidence collected from ${items.length} result${items.length === 1 ? "" : "s"}`,
    summary: items.slice(0, 3).map((item) => item.title).join("; "),
    confidence: Number(
      (items.reduce((sum, item) => sum + item.qualityScore, 0) / Math.max(1, items.length)).toFixed(2),
    ),
    evidenceIds: items.map((item) => item.id),
    contradictions: items.filter((item) => item.contradicts.length).flatMap((item) => item.contradicts),
  }));
}

/**
 * Run confidence is calculated transparently:
 * - evidence quality (average quality score)
 * - source diversity (unique providers contributing)
 * - contradiction penalty (each contradiction reduces confidence)
 */
function calculateConfidence(evidence: Evidence[], contradictionCount: number): number {
  if (!evidence.length) return 0;
  const avgQuality = evidence.reduce((sum, item) => sum + item.qualityScore, 0) / evidence.length;
  const uniqueSources = new Set(evidence.map((item) => item.source)).size;
  const diversityBonus = Math.min(0.2, uniqueSources * 0.07);
  const contradictionPenalty = Math.min(0.3, contradictionCount * 0.08);
  return Number(Math.max(0, Math.min(1, avgQuality + diversityBonus - contradictionPenalty)).toFixed(2));
}

/**
 * Run research across all providers. A provider failure never aborts the run and
 * never fabricates evidence. Statuses and errors are reported honestly.
 *
 * The orchestrator re-normalizes every provider row itself so malformed provider
 * output is dropped instead of crashing or leaking into evidence.
 */
export async function runResearch(
  opportunityId: string,
  title: string,
  providerOverrides?: ResearchProvider[],
): Promise<ResearchRun> {
  const startedAt = new Date().toISOString();
  const queries = makeQueries(title);
  const providers = providerOverrides ?? getResearchProviders();
  const rawEvidence: Evidence[] = [];
  const errors: string[] = [];
  const providerStatuses: ProviderRunStatus[] = [];
  const attempted: ResearchProviderName[] = [];
  const succeeded: ResearchProviderName[] = [];
  let droppedMalformed = 0;

  for (const provider of providers) {
    attempted.push(provider.name);
    // Providers not in the standard query plan still execute one default query
    // so injected/extra providers are honestly attempted rather than skipped.
    const providerQueries = queries.filter((query) => query.source === provider.name);
    const effectiveQueries = providerQueries.length
      ? providerQueries
      : [{ query: title, source: provider.name, purpose: "market" as const }];
    try {
      let providerEvidence: Evidence[] = [];
      for (const query of effectiveQueries) {
        const results = await provider.search(query);
        if (!Array.isArray(results)) {
          droppedMalformed += 1;
          continue;
        }
        for (const raw of results) {
          if (isPreNormalizedEvidence(raw)) {
            providerEvidence.push(raw);
            continue;
          }
          const normalized = normalizeEvidenceItem(
            raw as unknown as Parameters<typeof normalizeEvidenceItem>[0],
            query.purpose,
          );
          if (normalized) {
            providerEvidence.push(normalized);
          } else {
            droppedMalformed += 1;
          }
        }
      }
      // Intra-provider dedup keeps one copy of repeated results per provider.
      const seen = new Set<string>();
      providerEvidence = providerEvidence.filter((item) => {
        if (seen.has(item.hash)) return false;
        seen.add(item.hash);
        return true;
      });
      rawEvidence.push(...providerEvidence);
      if (providerEvidence.length) {
        succeeded.push(provider.name);
        providerStatuses.push({ name: provider.name, status: "SUCCEEDED", evidenceCount: providerEvidence.length, error: null });
      } else {
        providerStatuses.push({ name: provider.name, status: "EMPTY", evidenceCount: 0, error: null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown provider error";
      errors.push(`${provider.name}: ${message}`);
      providerStatuses.push({
        name: provider.name,
        status: isProviderNotConfigured(error) ? "CONFIG_ERROR" : "FAILED",
        evidenceCount: 0,
        error: message,
      });
    }
  }

  // Cross-provider dedup preserves source diversity without inflating counts.
  const { evidence: cleanEvidence, duplicatesRemoved } = dedupeEvidence(rawEvidence);
  if (droppedMalformed > 0) {
    errors.push(`normalization: dropped ${droppedMalformed} malformed provider result(s)`);
  }
  if (duplicatesRemoved > 0) {
    errors.push(`dedup: removed ${duplicatesRemoved} duplicate evidence item(s) across providers`);
  }

  const findings = buildFindings(cleanEvidence);
  const contradictionCount = countContradictions(cleanEvidence, findings);
  const confidence = calculateConfidence(cleanEvidence, contradictionCount);
  const signals = buildValidationSignals(cleanEvidence);
  const { conclusion, basis: conclusionBasis } = buildConclusion(
    cleanEvidence,
    signals,
    confidence,
    contradictionCount,
    attempted.length,
    succeeded.length,
  );
  const scoreIntegration = buildScoreIntegration(signals, conclusion, cleanEvidence);

  // Status reflects provider execution honestly:
  // - FAILED  -> nothing usable was collected AND something actually went wrong
  // - PARTIAL -> evidence exists but at least one provider failed or is unconfigured
  // - COMPLETED -> all attempted providers ran; an empty result is still COMPLETED
  //   (the conclusion then honestly states INSUFFICIENT_EVIDENCE)
  const failingProviders = providerStatuses.filter(
    (p) => p.status === "FAILED" || p.status === "CONFIG_ERROR",
  ).length;
  const status: ResearchRun["status"] =
    !cleanEvidence.length && (failingProviders > 0 || droppedMalformed > 0)
      ? "FAILED"
      : failingProviders > 0
        ? "PARTIAL"
        : "COMPLETED";

  return {
    id: runId(),
    opportunityId,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    queries,
    evidence: cleanEvidence,
    findings,
    validationSignals: signals,
    confidence,
    conclusion,
    conclusionBasis,
    providersAttempted: attempted,
    providersSucceeded: succeeded,
    providerStatuses,
    errors,
    scoreIntegration,
  };
}
