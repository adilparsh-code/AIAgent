import type { ResearchProvider } from "./base-provider";
import { extraTitlesFromEvidence, generateCandidates, normalizeCandidateKey } from "./discovery-candidates";
import { buildRankingBreakdown, compareCandidatesForRank } from "./discovery-ranking";
import { buildIncomeLabHandoff, buildOpportunityBrief, deriveHandoffStatus } from "./opportunity-brief";
import { buildOpportunityEvidenceBundle } from "./opportunity-validation";
import { runResearch } from "./research-orchestrator";
import type {
  DiscoveryCandidateSeed,
  DiscoveryCategory,
  DiscoveryRunResult,
  EvaluatedCandidate,
  EvaluatedCandidateView,
} from "./discovery-types";
import { getResearchProviders } from "./research-providers";
import type { Evidence } from "./research-types";

function runId(): string {
  return `discovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function candidateId(): string {
  return `cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function skippedDuplicate(seed: DiscoveryCandidateSeed, reason: string): EvaluatedCandidate {
  return {
    seed,
    status: "SKIPPED_DUPLICATE",
    opportunityId: null,
    researchRun: null,
    evidence: [],
    bundle: null,
    ranking: null,
    brief: null,
    handoff: null,
    scoreIntegration: null,
    errors: [reason],
  };
}

async function harvestExtraTitles(
  topic: string,
  providers: ResearchProvider[],
): Promise<{ titles: string[]; errors: string[] }> {
  const errors: string[] = [];
  const titles: string[] = [];
  const harvesters = providers.filter((provider) => provider.name === "brave" || provider.name === "reddit");
  for (const provider of harvesters) {
    try {
      const results = await provider.search({
        query: `${topic} opportunity demand`,
        source: provider.name,
        purpose: "market",
      });
      if (!Array.isArray(results)) continue;
      titles.push(...results.map((item) => (item && typeof item.title === "string" ? item.title : "")).filter(Boolean));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown provider error";
      errors.push(`harvest ${provider.name}: ${message}`);
    }
  }
  return { titles: extraTitlesFromEvidence(titles, topic, 2), errors };
}

async function evaluateSeed(
  seed: DiscoveryCandidateSeed,
  discoveryRunId: string,
  candidateRowId: string,
  providers: ResearchProvider[],
  placeholderOpportunityId: string,
): Promise<EvaluatedCandidate> {
  const errors: string[] = [];
  try {
    const researchRun = await runResearch(placeholderOpportunityId, seed.researchTitle, providers);
    const bundle = buildOpportunityEvidenceBundle(researchRun);
    const ranking = buildRankingBreakdown(bundle, researchRun.scoreIntegration);
    const handoffStatus = deriveHandoffStatus(bundle.conclusion, bundle);
    const brief = buildOpportunityBrief({
      candidateId: candidateRowId,
      opportunityId: null,
      seed,
      run: researchRun,
      bundle,
      ranking,
      handoffStatus,
      errors: researchRun.errors,
    });
    const handoff = buildIncomeLabHandoff({
      candidateId: candidateRowId,
      discoveryRunId,
      opportunityId: null,
      seed,
      bundle,
      ranking,
      brief,
      handoffStatus,
    });
    return {
      seed,
      status: "RESEARCHED",
      opportunityId: null,
      researchRun,
      evidence: researchRun.evidence,
      bundle,
      ranking,
      brief,
      handoff,
      scoreIntegration: researchRun.scoreIntegration,
      errors: [...errors, ...researchRun.errors],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown research error";
    return {
      seed,
      status: "RESEARCHED",
      opportunityId: null,
      researchRun: null,
      evidence: [],
      bundle: null,
      ranking: null,
      brief: null,
      handoff: null,
      scoreIntegration: null,
      errors: [...errors, message],
    };
  }
}

export function dedupeSeeds(
  seeds: DiscoveryCandidateSeed[],
  priorKeys: Set<string> = new Set(),
): { unique: DiscoveryCandidateSeed[]; duplicates: DiscoveryCandidateSeed[] } {
  const unique: DiscoveryCandidateSeed[] = [];
  const duplicates: DiscoveryCandidateSeed[] = [];
  const seen = new Set(priorKeys);
  for (const seed of seeds) {
    const key = seed.normalizedKey || normalizeCandidateKey(seed.title);
    if (!key || seen.has(key)) {
      duplicates.push(seed);
      continue;
    }
    seen.add(key);
    unique.push(seed);
  }
  return { unique, duplicates };
}

export async function runDiscovery(input: {
  topic: string;
  category: DiscoveryCategory;
  maxCandidates?: number;
  providers?: ResearchProvider[];
  extraTitles?: string[];
  priorNormalizedKeys?: string[];
  harvestFromProviders?: boolean;
  discoveryRunId?: string;
}): Promise<{
  result: DiscoveryRunResult;
  evaluated: Array<EvaluatedCandidate & { id: string }>;
}> {
  const startedAt = new Date().toISOString();
  const id = input.discoveryRunId ?? runId();
  const providers = input.providers ?? getResearchProviders();
  const errors: string[] = [];
  let extraTitles = input.extraTitles ?? [];

  if (input.harvestFromProviders) {
    const harvested = await harvestExtraTitles(input.topic, providers);
    extraTitles = [...extraTitles, ...harvested.titles];
    errors.push(...harvested.errors);
  }

  const generated = generateCandidates(input.topic, input.category, {
    extraTitles,
    maxCandidates: input.maxCandidates,
  });
  const { unique, duplicates } = dedupeSeeds(generated, new Set(input.priorNormalizedKeys ?? []));

  const evaluated: Array<EvaluatedCandidate & { id: string }> = [];

  for (const seed of duplicates) {
    evaluated.push({
      id: candidateId(),
      ...skippedDuplicate(seed, "Duplicate candidate skipped before research."),
    });
  }

  for (const seed of unique) {
    const rowId = candidateId();
    const placeholderOpportunityId = `discovery-pending-${rowId}`;
    const next = await evaluateSeed(seed, id, rowId, providers, placeholderOpportunityId);
    evaluated.push({ id: rowId, ...next });
  }

  const ranked = evaluated
    .filter((item) => item.status === "RESEARCHED" && item.ranking)
    .sort((a, b) =>
      compareCandidatesForRank(
        {
          rankingScore: a.ranking?.rankingScore ?? 0,
          evidenceCoverage: a.bundle?.evidenceCoverage ?? 0,
          contradictionCount: a.bundle?.contradictionCount ?? 0,
          confidence: a.bundle?.confidence ?? 0,
        },
        {
          rankingScore: b.ranking?.rankingScore ?? 0,
          evidenceCoverage: b.bundle?.evidenceCoverage ?? 0,
          contradictionCount: b.bundle?.contradictionCount ?? 0,
          confidence: b.bundle?.confidence ?? 0,
        },
      ),
    );

  const rankById = new Map<string, number>();
  ranked.forEach((item, index) => rankById.set(item.id, index + 1));

  const views: EvaluatedCandidateView[] = evaluated.map((item) => toView(item, rankById.get(item.id) ?? null));
  const researchedCount = views.filter((item) => item.status === "RESEARCHED").length;
  const failedResearch = views.filter((item) => item.status === "RESEARCHED" && !item.researchRunId).length;
  const readyForHandoffCount = views.filter((item) => item.handoffStatus === "READY").length;
  const providerFailedAll = researchedCount > 0 && views.every((item) => item.evidenceCount === 0 && item.status === "RESEARCHED");

  let status: DiscoveryRunResult["status"] = "COMPLETED";
  if (researchedCount === 0) status = "FAILED";
  else if (failedResearch > 0 || errors.length > 0 || providerFailedAll) status = "PARTIAL";
  if (unique.length === 0 && duplicates.length === 0) status = "FAILED";

  const completedAt = new Date().toISOString();
  const result: DiscoveryRunResult = {
    id,
    topic: input.topic,
    category: input.category,
    status,
    startedAt,
    completedAt,
    candidateCount: views.length,
    researchedCount,
    readyForHandoffCount,
    errors,
    notes:
      unique.length === 0
        ? "No unique research candidates were generated."
        : "Candidates are hypotheses until researched. Missing evidence is not support. AI estimates are not facts.",
    candidates: views.sort((a, b) => {
      if (a.rank == null && b.rank == null) return 0;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    }),
  };

  return { result, evaluated };
}

export function toView(
  item: EvaluatedCandidate & { id: string },
  rank: number | null,
  timestamps?: { createdAt?: string; updatedAt?: string },
): EvaluatedCandidateView {
  const now = new Date().toISOString();
  return {
    id: item.id,
    title: item.seed.title,
    category: item.seed.category,
    problemHypothesis: item.seed.problemHypothesis,
    targetAudience: item.seed.targetAudience,
    normalizedKey: item.seed.normalizedKey,
    status: item.status,
    opportunityId: item.opportunityId,
    researchRunId: item.researchRun?.id ?? null,
    rank,
    rankingScore: item.ranking?.rankingScore ?? null,
    confidence: item.bundle?.confidence ?? null,
    validationConclusion: item.bundle?.conclusion ?? null,
    evidenceCount: item.evidence.length,
    evidenceCoverage: item.bundle?.evidenceCoverage ?? 0,
    sourceDiversity: item.bundle?.sourceDiversity ?? 0,
    contradictionCount: item.bundle?.contradictionCount ?? 0,
    brief: item.brief
      ? {
          ...item.brief,
          candidateId: item.id,
          scoreBreakdown: item.ranking
            ? item.ranking
            : item.brief.scoreBreakdown,
        }
      : null,
    rankingBreakdown: item.ranking,
    handoffPayload: item.handoff
      ? { ...item.handoff, candidateId: item.id }
      : null,
    handoffStatus: item.handoff?.handoffStatus ?? "NOT_READY",
    errors: item.errors,
    createdAt: timestamps?.createdAt ?? now,
    updatedAt: timestamps?.updatedAt ?? now,
  };
}

export function evidenceTitles(evidence: Evidence[]): string[] {
  return evidence.map((item) => item.title);
}
