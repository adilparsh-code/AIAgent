import type { BusinessModel, Category } from "./types";
import type {
  Evidence,
  ProviderRunStatus,
  ResearchConclusion,
  ResearchRun,
  ScoreIntegration,
  ValidationSignal,
} from "./research-types";

export const DISCOVERY_CATEGORIES = [
  "digital-products",
  "apps",
  "affiliate",
  "education",
  "pinterest-content",
  "saas",
  "ai-tools",
  "childrens-activities",
  "other",
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

export type DiscoveryRunStatus = "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type DiscoveryCandidateStatus = "GENERATED" | "RESEARCHING" | "RESEARCHED" | "SKIPPED_DUPLICATE";
export type HandoffStatus = "NOT_READY" | "READY" | "PREPARED";

export type ScoreProvenance = "evidence-backed" | "calculated" | "ai-estimate" | "unmeasured";

export interface DiscoveryCandidateSeed {
  title: string;
  category: DiscoveryCategory;
  problemHypothesis: string;
  targetAudience: string;
  researchTitle: string;
  normalizedKey: string;
  opportunityCategory: Category;
  businessModel: BusinessModel;
}

export interface OpportunityEvidenceBundle {
  demand: ValidationSignal;
  painPoint: ValidationSignal;
  trend: ValidationSignal;
  commercialIntent: ValidationSignal;
  competition: ValidationSignal;
  monetization: ValidationSignal;
  evidenceQuality: number;
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  providerStatuses: ProviderRunStatus[];
  contradictions: string[];
  conclusion: ResearchConclusion;
  conclusionBasis: string;
  confidence: number;
}

export interface RankedFactor {
  key: string;
  label: string;
  value: number | null;
  provenance: ScoreProvenance;
  basis: string;
}

export interface RankingBreakdown {
  rankingScore: number;
  evidenceBackedScore: number;
  calculatedScore: number | null;
  aiEstimateScore: number | null;
  coverageRatio: number;
  factors: RankedFactor[];
  note: string;
}

export interface OpportunityBrief {
  opportunityId: string | null;
  candidateId: string;
  title: string;
  category: DiscoveryCategory;
  problem: string;
  targetAudience: string;
  demandEvidence: { status: string; basis: string; urls: string[] };
  marketTrendEvidence: { status: string; basis: string; urls: string[] };
  monetizationPossibilities: { status: string; basis: string; options: string[] };
  competitionAlternatives: { status: string; basis: string; urls: string[] };
  risks: string[];
  contradictions: string[];
  confidence: number;
  validationConclusion: ResearchConclusion;
  conclusionBasis: string;
  scoreBreakdown: RankingBreakdown;
  evidenceUrls: string[];
  recommendedNextExperiment: string;
  aiIncomeLabHandoffStatus: HandoffStatus;
  dataClasses: string[];
}

export interface IncomeLabHandoff {
  opportunityId: string | null;
  candidateId: string;
  discoveryRunId: string;
  title: string;
  validationConclusion: ResearchConclusion;
  confidence: number;
  score: number;
  evidence: {
    urls: string[];
    coverage: number;
    sourceDiversity: number;
    contradictionCount: number;
    quality: number;
  };
  monetizationOptions: string[];
  risks: string[];
  recommendedExperiment: string;
  handoffStatus: HandoffStatus;
}

export interface EvaluatedCandidate {
  seed: DiscoveryCandidateSeed;
  status: DiscoveryCandidateStatus;
  opportunityId: string | null;
  researchRun: ResearchRun | null;
  evidence: Evidence[];
  bundle: OpportunityEvidenceBundle | null;
  ranking: RankingBreakdown | null;
  brief: OpportunityBrief | null;
  handoff: IncomeLabHandoff | null;
  scoreIntegration: ScoreIntegration | null;
  errors: string[];
}

export interface DiscoveryRunResult {
  id: string;
  topic: string;
  category: DiscoveryCategory;
  status: DiscoveryRunStatus;
  startedAt: string;
  completedAt: string | null;
  candidateCount: number;
  researchedCount: number;
  readyForHandoffCount: number;
  errors: string[];
  notes: string;
  candidates: EvaluatedCandidateView[];
}

export interface EvaluatedCandidateView {
  id: string;
  title: string;
  category: DiscoveryCategory;
  problemHypothesis: string;
  targetAudience: string;
  normalizedKey: string;
  status: DiscoveryCandidateStatus;
  opportunityId: string | null;
  researchRunId: string | null;
  rank: number | null;
  rankingScore: number | null;
  confidence: number | null;
  validationConclusion: ResearchConclusion | null;
  evidenceCount: number;
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  brief: OpportunityBrief | null;
  rankingBreakdown: RankingBreakdown | null;
  handoffPayload: IncomeLabHandoff | null;
  handoffStatus: HandoffStatus;
  errors: string[];
  createdAt: string;
  updatedAt: string;
}

export const HANDOFF_READY_CONCLUSIONS: ResearchConclusion[] = ["VALIDATED", "PROMISING"];
