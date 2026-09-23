import type { Evidence, ResearchConclusion, ResearchRun } from "./research-types";
import type {
  DiscoveryCandidateSeed,
  HandoffStatus,
  IncomeLabHandoff,
  OpportunityBrief,
  OpportunityEvidenceBundle,
  RankingBreakdown,
} from "./discovery-types";
import { HANDOFF_READY_CONCLUSIONS } from "./discovery-types";
import { providerHealthSummary } from "./opportunity-validation";

function urlsFor(evidence: Evidence[], ids: string[]): string[] {
  const wanted = new Set(ids);
  const urls = evidence
    .filter((item) => wanted.has(item.id) && /^https?:\/\//i.test(item.url))
    .map((item) => item.url);
  return Array.from(new Set(urls));
}

function allEvidenceUrls(evidence: Evidence[]): string[] {
  return Array.from(new Set(evidence.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => item.url)));
}

export function recommendedExperiment(conclusion: ResearchConclusion, bundle: OpportunityEvidenceBundle): string {
  switch (conclusion) {
    case "VALIDATED":
      return "Run a small, time-boxed experiment (landing page + one offer) to test whether evidenced demand converts. Implementation belongs to AI Income Lab, not this engine.";
    case "PROMISING":
      return "Do not implement yet. Collect more evidence for currently MIXED/INSUFFICIENT signals, then re-validate.";
    case "CONTRADICTED":
      return "Do not implement. Resolve contradictions with human review before any experiment.";
    case "REQUIRES_HUMAN_REVIEW":
      return "Human review required. Automated discovery will not mark this ready for implementation.";
    case "REJECTED":
      return "Do not implement.";
    default:
      return bundle.evidenceCoverage === 0
        ? "Do not implement. No usable evidence was collected; missing data is not support."
        : "Do not implement. Evidence is insufficient to justify an experiment.";
  }
}

export function deriveRisks(bundle: OpportunityEvidenceBundle, errors: string[]): string[] {
  const risks: string[] = [];
  if (bundle.evidenceCoverage === 0) {
    risks.push("No usable evidence collected — opportunity is not implementation-ready.");
  }
  if (bundle.demand.status === "INSUFFICIENT") {
    risks.push("Demand is unmeasured (insufficient evidence), not proven.");
  }
  if (bundle.painPoint.status === "INSUFFICIENT") {
    risks.push("Pain/problem evidence is missing.");
  }
  if (bundle.monetization.status === "INSUFFICIENT") {
    risks.push("No monetization evidence. Do not assume a revenue model.");
  }
  if (bundle.competition.status === "INSUFFICIENT") {
    risks.push("Competition is unmeasured — absence of results is not a low-competition signal.");
  }
  if (bundle.contradictionCount > 0) {
    risks.push(`${bundle.contradictionCount} contradiction(s) recorded in evidence.`);
  }
  for (const status of bundle.providerStatuses) {
    if (status.status === "CONFIG_ERROR") {
      risks.push(`Provider ${status.name} was not configured; coverage is incomplete.`);
    }
    if (status.status === "FAILED") {
      risks.push(`Provider ${status.name} failed; coverage is incomplete.`);
    }
  }
  if (errors.length) {
    risks.push("Research reported errors; treat results as incomplete.");
  }
  return Array.from(new Set(risks));
}

export function deriveHandoffStatus(conclusion: ResearchConclusion, bundle: OpportunityEvidenceBundle): HandoffStatus {
  if (bundle.evidenceCoverage === 0) return "NOT_READY";
  if (HANDOFF_READY_CONCLUSIONS.includes(conclusion) && bundle.contradictionCount === 0) {
    return "READY";
  }
  return "NOT_READY";
}

export function monetizationOptionsFromEvidence(bundle: OpportunityEvidenceBundle): string[] {
  if (bundle.monetization.status === "INSUFFICIENT") return [];
  return [
    "Commercial-intent evidence exists; a specific revenue method is not measured by current providers and must not be treated as a sales forecast.",
  ];
}

export function buildOpportunityBrief(input: {
  candidateId: string;
  opportunityId: string | null;
  seed: DiscoveryCandidateSeed;
  run: ResearchRun;
  bundle: OpportunityEvidenceBundle;
  ranking: RankingBreakdown;
  handoffStatus: HandoffStatus;
  errors: string[];
}): OpportunityBrief {
  const { seed, run, bundle, ranking } = input;
  return {
    opportunityId: input.opportunityId,
    candidateId: input.candidateId,
    title: seed.title,
    category: seed.category,
    problem: seed.problemHypothesis,
    targetAudience: seed.targetAudience,
    demandEvidence: {
      status: bundle.demand.status,
      basis: bundle.demand.basis,
      urls: urlsFor(run.evidence, bundle.demand.evidenceIds),
    },
    marketTrendEvidence: {
      status: bundle.trend.status,
      basis: bundle.trend.basis,
      urls: urlsFor(run.evidence, bundle.trend.evidenceIds),
    },
    monetizationPossibilities: {
      status: bundle.monetization.status,
      basis: bundle.monetization.basis,
      options: monetizationOptionsFromEvidence(bundle),
    },
    competitionAlternatives: {
      status: bundle.competition.status,
      basis: bundle.competition.basis,
      urls: urlsFor(run.evidence, bundle.competition.evidenceIds),
    },
    risks: [...deriveRisks(bundle, input.errors), ...providerHealthSummary(bundle.providerStatuses)],
    contradictions: bundle.contradictions,
    confidence: bundle.confidence,
    validationConclusion: bundle.conclusion,
    conclusionBasis: bundle.conclusionBasis,
    scoreBreakdown: ranking,
    evidenceUrls: allEvidenceUrls(run.evidence),
    recommendedNextExperiment: recommendedExperiment(bundle.conclusion, bundle),
    aiIncomeLabHandoffStatus: input.handoffStatus,
    dataClasses: Array.from(new Set(run.evidence.map((item) => item.dataClass))),
  };
}

export function buildIncomeLabHandoff(input: {
  candidateId: string;
  discoveryRunId: string;
  opportunityId: string | null;
  seed: DiscoveryCandidateSeed;
  bundle: OpportunityEvidenceBundle;
  ranking: RankingBreakdown;
  brief: OpportunityBrief;
  handoffStatus: HandoffStatus;
}): IncomeLabHandoff {
  return {
    opportunityId: input.opportunityId,
    candidateId: input.candidateId,
    discoveryRunId: input.discoveryRunId,
    title: input.seed.title,
    validationConclusion: input.bundle.conclusion,
    confidence: input.bundle.confidence,
    score: input.ranking.rankingScore,
    evidence: {
      urls: input.brief.evidenceUrls,
      coverage: input.bundle.evidenceCoverage,
      sourceDiversity: input.bundle.sourceDiversity,
      contradictionCount: input.bundle.contradictionCount,
      quality: input.bundle.evidenceQuality,
    },
    monetizationOptions: input.brief.monetizationPossibilities.options,
    risks: deriveRisks(input.bundle, []),
    recommendedExperiment: input.brief.recommendedNextExperiment,
    handoffStatus: input.handoffStatus,
  };
}

export function markHandoffPrepared(handoff: IncomeLabHandoff): IncomeLabHandoff {
  if (handoff.handoffStatus !== "READY" && handoff.handoffStatus !== "PREPARED") {
    return handoff;
  }
  return { ...handoff, handoffStatus: "PREPARED" };
}
