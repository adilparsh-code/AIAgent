import "server-only";
import type { ResearchProvider } from "../base-provider";
import { extraTitlesFromEvidence, generateCandidates } from "../discovery-candidates";
import { dedupeSeeds } from "../discovery-engine";
import { buildRankingBreakdown, compareCandidatesForRank } from "../discovery-ranking";
import { DISCOVERY_LIMITS } from "../discovery-input";
import {
  buildIncomeLabHandoff,
  buildOpportunityBrief,
  deriveHandoffStatus,
  markHandoffPrepared,
} from "../opportunity-brief";
import { buildOpportunityEvidenceBundle } from "../opportunity-validation";
import { getResearchProviders } from "../research-providers";
import { runResearch } from "../research-orchestrator";
import type { DiscoveryCategory, DiscoveryRunResult, EvaluatedCandidateView, IncomeLabHandoff } from "../discovery-types";
import type { Prisma } from "@prisma/client";
import { discoveryRepository } from "./repositories/discovery";
import { researchRepository } from "./repositories/research";
import { createOpportunityForCandidate } from "./discovery-opportunity";

async function harvestTitles(topic: string, providers: ResearchProvider[]): Promise<{ titles: string[]; errors: string[] }> {
  const errors: string[] = [];
  const titles: string[] = [];
  for (const provider of providers.filter((item) => item.name === "brave" || item.name === "reddit")) {
    try {
      const results = await provider.search({
        query: `${topic} opportunity demand`,
        source: provider.name,
        purpose: "market",
      });
      if (!Array.isArray(results)) continue;
      titles.push(...results.map((item) => (item && typeof item.title === "string" ? item.title : "")).filter(Boolean));
    } catch (error) {
      errors.push(`harvest ${provider.name}: ${error instanceof Error ? error.message : "unknown provider error"}`);
    }
  }
  return { titles: extraTitlesFromEvidence(titles, topic, 2), errors };
}

export async function executeDiscoveryRun(input: {
  topic: string;
  category: DiscoveryCategory;
  maxCandidates?: number;
  providers?: ResearchProvider[];
}): Promise<DiscoveryRunResult> {
  const providers = input.providers ?? getResearchProviders();
  const run = await discoveryRepository.createRunning({
    topic: input.topic,
    category: input.category,
    notes: "Candidates are hypotheses until researched. Missing evidence is not support.",
  });

  try {
    return await executeDiscoveryRunBody(run.id, input, providers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown discovery error";
    return discoveryRepository.completeRun(run.id, {
      status: "FAILED",
      candidateCount: 0,
      researchedCount: 0,
      readyForHandoffCount: 0,
      errors: [message],
    });
  }
}

async function executeDiscoveryRunBody(
  runId: string,
  input: {
    topic: string;
    category: DiscoveryCategory;
    maxCandidates?: number;
  },
  providers: ResearchProvider[],
): Promise<DiscoveryRunResult> {
  const errors: string[] = [];

  const harvested = await harvestTitles(input.topic, providers);
  errors.push(...harvested.errors);

  const generated = generateCandidates(input.topic, input.category, {
    extraTitles: harvested.titles,
    maxCandidates: input.maxCandidates ?? DISCOVERY_LIMITS.MAX_CANDIDATES,
  });
  const { unique, duplicates } = dedupeSeeds(generated);

  const views: EvaluatedCandidateView[] = [];

  if (duplicates.length) {
    errors.push(
      `${duplicates.length} duplicate candidate(s) skipped before research (same normalized title).`,
    );
  }

  for (const seed of unique) {
    const created = await discoveryRepository.addCandidate({
      discoveryRunId: runId,
      title: seed.title,
      category: seed.category,
      problemHypothesis: seed.problemHypothesis,
      targetAudience: seed.targetAudience,
      normalizedKey: seed.normalizedKey,
      status: "GENERATED",
    });

    try {
      await discoveryRepository.updateCandidate(created.id, { status: "RESEARCHING" });
      const researchRun = await runResearch(`pending-${created.id}`, seed.researchTitle, providers);
      const bundle = buildOpportunityEvidenceBundle(researchRun);
      const ranking = buildRankingBreakdown(bundle, researchRun.scoreIntegration);
      const handoffStatus = deriveHandoffStatus(bundle.conclusion, bundle);
      const opportunity = await createOpportunityForCandidate(
        seed,
        bundle,
        buildOpportunityBrief({
          candidateId: created.id,
          opportunityId: null,
          seed,
          run: researchRun,
          bundle,
          ranking,
          handoffStatus,
          errors: researchRun.errors,
        }).recommendedNextExperiment,
      );

      const persistedResearch = { ...researchRun, opportunityId: opportunity.id };
      const savedResearch = await researchRepository.save(persistedResearch);

      const brief = buildOpportunityBrief({
        candidateId: created.id,
        opportunityId: opportunity.id,
        seed,
        run: savedResearch,
        bundle,
        ranking,
        handoffStatus,
        errors: savedResearch.errors,
      });
      const handoff = buildIncomeLabHandoff({
        candidateId: created.id,
        discoveryRunId: runId,
        opportunityId: opportunity.id,
        seed,
        bundle,
        ranking,
        brief,
        handoffStatus,
      });

      const updated = await discoveryRepository.updateCandidate(created.id, {
        status: "RESEARCHED",
        opportunityId: opportunity.id,
        researchRunId: savedResearch.id,
        rankingScore: ranking.rankingScore,
        confidence: bundle.confidence,
        validationConclusion: bundle.conclusion,
        evidenceCount: savedResearch.evidence.length,
        evidenceCoverage: bundle.evidenceCoverage,
        sourceDiversity: bundle.sourceDiversity,
        contradictionCount: bundle.contradictionCount,
        brief: brief as unknown as Prisma.InputJsonValue,
        rankingBreakdown: ranking as unknown as Prisma.InputJsonValue,
        handoffPayload: handoff as unknown as Prisma.InputJsonValue,
        handoffStatus,
        errors: [...savedResearch.errors],
      });
      views.push(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown discovery error";
      errors.push(`${seed.title}: ${message}`);
      const updated = await discoveryRepository.updateCandidate(created.id, {
        status: "RESEARCHED",
        errors: [message],
        handoffStatus: "NOT_READY",
      });
      views.push(updated);
    }
  }

  const researched = views.filter((item) => item.status === "RESEARCHED");
  const ranked = [...researched].sort((a, b) =>
    compareCandidatesForRank(
      {
        rankingScore: a.rankingScore ?? 0,
        evidenceCoverage: a.evidenceCoverage,
        contradictionCount: a.contradictionCount,
        confidence: a.confidence ?? 0,
      },
      {
        rankingScore: b.rankingScore ?? 0,
        evidenceCoverage: b.evidenceCoverage,
        contradictionCount: b.contradictionCount,
        confidence: b.confidence ?? 0,
      },
    ),
  );
  for (const [index, item] of ranked.entries()) {
    await discoveryRepository.updateCandidate(item.id, { rank: index + 1 });
  }

  const readyForHandoffCount = views.filter((item) => item.handoffStatus === "READY").length;
  let status: DiscoveryRunResult["status"] = "COMPLETED";
  if (unique.length === 0) status = duplicates.length ? "COMPLETED" : "FAILED";
  else if (researched.length === 0) status = "FAILED";
  else if (errors.length > 0 || researched.some((item) => item.errors.length > 0 && item.evidenceCount === 0)) {
    status = researched.some((item) => item.evidenceCount > 0) ? "PARTIAL" : "FAILED";
  }

  return discoveryRepository.completeRun(runId, {
    status,
    candidateCount: views.length,
    researchedCount: researched.length,
    readyForHandoffCount,
    errors,
  });
}

export async function prepareHandoff(candidateId: string): Promise<
  { ok: true; candidate: EvaluatedCandidateView; handoff: IncomeLabHandoff } | { ok: false; error: string; status: number }
> {
  const found = await discoveryRepository.getCandidate(candidateId);
  if (!found) return { ok: false, error: "Candidate not found", status: 404 };
  const payload = found.candidate.handoffPayload;
  if (!payload || found.candidate.handoffStatus === "NOT_READY") {
    return {
      ok: false,
      error: "Candidate is not ready for AI Income Lab handoff. Evidence is insufficient or contradictions remain.",
      status: 409,
    };
  }
  const prepared = markHandoffPrepared(payload);
  const candidate = await discoveryRepository.markHandoffPrepared(
    candidateId,
    prepared as unknown as Prisma.InputJsonValue,
  );
  if (!candidate) return { ok: false, error: "Candidate not found", status: 404 };
  return { ok: true, candidate, handoff: prepared };
}
