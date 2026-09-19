export type ResearchProviderName = "brave" | "reddit" | "google-trends" | (string & {});

export type ResearchPurpose =
  | "demand"
  | "commercial-intent"
  | "competition"
  | "trend"
  | "pain-point"
  | "market";

export interface ResearchQuery {
  query: string;
  source: ResearchProviderName;
  purpose: ResearchPurpose;
}

export type EvidenceDataClass = "REAL_LIVE_DATA" | "SAMPLE_DATA" | "AI_ESTIMATE" | "UNAVAILABLE";

export interface Evidence {
  id: string;
  source: ResearchProviderName;
  title: string;
  url: string;
  snippet: string;
  collectedAt: string;
  relevanceScore: number;
  qualityScore: number;
  hash: string;
  supports: ResearchPurpose[];
  contradicts: string[];
  dataClass: EvidenceDataClass;
}

export interface ResearchFinding {
  id: string;
  claim: string;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  contradictions: string[];
}

/**
 * A validation signal is always derived from evidence. The purpose list names the
 * exact evidence purposes that back the signal so it is traceable end to end.
 */
export type SignalStatus = "SUPPORTED" | "MIXED" | "INSUFFICIENT";

export interface ValidationSignal {
  key: string;
  label: string;
  status: SignalStatus;
  /** Evidence ids the signal is based on. Empty when INSUFFICIENT. */
  evidenceIds: string[];
  basis: string;
}

export type ResearchConclusion =
  | "VALIDATED"
  | "PROMISING"
  | "INSUFFICIENT_EVIDENCE"
  | "CONTRADICTED"
  | "REQUIRES_HUMAN_REVIEW"
  | "REJECTED";

export interface ProviderRunStatus {
  name: ResearchProviderName;
  status: "SUCCEEDED" | "EMPTY" | "CONFIG_ERROR" | "FAILED" | "UNAVAILABLE";
  evidenceCount: number;
  error: string | null;
}

export type ScoreGuidanceStatus =
  | "research-supported"
  | "research-unsupported"
  | "insufficient-evidence"
  | "human-review-required"
  | "unchanged";

export interface ScoreFactorGuidance {
  key: keyof ScoreBreakdownKeys;
  status: ScoreGuidanceStatus;
  basis: string;
}

export interface ScoreBreakdownKeys {
  demand: number;
  commercialIntent: number;
  competitionOpportunity: number;
  startupCost: number;
  automationPotential: number;
  differentiation: number;
  monetizationStrength: number;
  halalCompliance: number;
}

export interface ScoreIntegration {
  /** Applied by the caller; never silently applied inside research. */
  suggestedOverallScore: number | null;
  factors: ScoreFactorGuidance[];
  note?: string;
}

export interface ResearchRun {
  id: string;
  opportunityId: string;
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  startedAt: string;
  completedAt: string | null;
  queries: ResearchQuery[];
  evidence: Evidence[];
  findings: ResearchFinding[];
  validationSignals: ValidationSignal[];
  confidence: number;
  conclusion: ResearchConclusion;
  conclusionBasis: string;
  providersAttempted: ResearchProviderName[];
  providersSucceeded: ResearchProviderName[];
  providerStatuses: ProviderRunStatus[];
  errors: string[];
  scoreIntegration: ScoreIntegration;
}
