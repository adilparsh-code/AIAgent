export type ResearchProviderName = "brave" | "reddit" | "google-trends" | (string & {});

export interface ResearchQuery {
  query: string;
  source: ResearchProviderName;
  purpose: "demand" | "commercial-intent" | "competition" | "trend" | "pain-point" | "market";
}

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
  supports: string[];
  contradicts: string[];
}

export interface ResearchFinding {
  id: string;
  claim: string;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  contradictions: string[];
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
  confidence: number;
  providersAttempted: ResearchProviderName[];
  providersSucceeded: ResearchProviderName[];
  errors: string[];
}
