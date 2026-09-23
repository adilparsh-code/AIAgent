import type {
  Agent,
  AgentRunRecord,
  Experiment,
  HandoffRecord,
  Opportunity,
  OpportunityHandoffContract,
  Product,
  ProductMetrics,
  RevenueEntry,
} from "./types";
import type {
  Evidence,
  EvidenceDataClass,
  PersistedValidation,
  ProviderRunStatus,
  ResearchFinding,
  ResearchQuery,
  ResearchRun,
  ResearchConclusion,
  ScoreIntegration,
  SignalStatus,
  ValidationSignal,
} from "./research-types";

function jsonValue<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function decimalToNumber(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function mapOpportunity(row: {
  id: string;
  title: string;
  category: Opportunity["category"];
  businessModel: Opportunity["businessModel"];
  targetAudience: string;
  problemSolved: string;
  monetizationMethod: string;
  estimatedStartupCost: { toNumber?: () => number } | number | string;
  demandScore: number;
  competitionScore: number;
  commercialIntentScore: number;
  automationScore: number;
  differentiationScore: number;
  monetizationStrengthScore: number;
  halalScore: number;
  halalStatus: Opportunity["halalStatus"];
  overallScore: { toNumber?: () => number } | number | string;
  confidence: number;
  status: Opportunity["status"];
  evidence: string[];
  risks: string[];
  nextAction: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Opportunity {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    businessModel: row.businessModel,
    targetAudience: row.targetAudience,
    problemSolved: row.problemSolved,
    monetizationMethod: row.monetizationMethod,
    estimatedStartupCost: decimalToNumber(row.estimatedStartupCost),
    demandScore: row.demandScore,
    competitionScore: row.competitionScore,
    commercialIntentScore: row.commercialIntentScore,
    automationScore: row.automationScore,
    differentiationScore: row.differentiationScore,
    monetizationStrengthScore: row.monetizationStrengthScore,
    halalScore: row.halalScore,
    halalStatus: row.halalStatus,
    overallScore: decimalToNumber(row.overallScore),
    confidence: row.confidence,
    status: row.status,
    evidence: row.evidence,
    risks: row.risks,
    nextAction: row.nextAction,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export function mapProduct(row: {
  id: string;
  name: string;
  type: Product["type"];
  targetAudience: string;
  opportunityId: string | null;
  status: Product["status"];
  price: { toNumber?: () => number } | number | string;
  cost: { toNumber?: () => number } | number | string;
  revenue: { toNumber?: () => number } | number | string;
  platform: string;
  productUrl: string | null;
  affiliateUrl: string | null;
  metrics: unknown;
  notes: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Product {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    targetAudience: row.targetAudience,
    opportunityId: row.opportunityId,
    status: row.status,
    price: decimalToNumber(row.price),
    cost: decimalToNumber(row.cost),
    revenue: decimalToNumber(row.revenue),
    platform: row.platform,
    productUrl: row.productUrl,
    affiliateUrl: row.affiliateUrl,
    metrics: (row.metrics as ProductMetrics | null) ?? {},
    notes: row.notes,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export function mapExperiment(row: {
  id: string;
  hypothesis: string;
  opportunityId: string;
  target: string;
  budget: { toNumber?: () => number } | number | string;
  startDate: Date | string;
  endDate: Date | string | null;
  expectedResult: string;
  actualResult: string | null;
  objective?: string | null;
  successCriteria?: unknown;
  metrics?: unknown;
  result?: string | null;
  notes?: string | null;
  feedback?: unknown;
  visitors: number;
  leads: number;
  clicks: number;
  sales: number;
  revenue: { toNumber?: () => number } | number | string;
  profit: { toNumber?: () => number } | number | string;
  conversionRate: { toNumber?: () => number } | number | string;
  decision: Experiment["decision"];
  status: Experiment["status"];
  handoffId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Experiment {
  return {
    id: row.id,
    hypothesis: row.hypothesis,
    opportunityId: row.opportunityId,
    target: row.target,
    budget: decimalToNumber(row.budget),
    startDate: iso(row.startDate)!,
    endDate: iso(row.endDate),
    expectedResult: row.expectedResult,
    actualResult: row.actualResult,
    objective: row.objective ?? null,
    successCriteria: stringArray(row.successCriteria),
    metrics: (row.metrics as Experiment["metrics"]) ?? null,
    result: row.result ?? null,
    notes: row.notes ?? "",
    feedback: (row.feedback as Experiment["feedback"]) ?? null,
    visitors: row.visitors,
    leads: row.leads,
    clicks: row.clicks,
    sales: row.sales,
    revenue: decimalToNumber(row.revenue),
    profit: decimalToNumber(row.profit),
    conversionRate: decimalToNumber(row.conversionRate),
    decision: row.decision,
    status: row.status,
    handoffId: row.handoffId ?? null,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export function mapRevenue(row: {
  id: string;
  date: Date | string;
  productId: string | null;
  opportunityId: string | null;
  revenueSource: RevenueEntry["revenueSource"];
  grossRevenue: { toNumber?: () => number } | number | string;
  fees: { toNumber?: () => number } | number | string;
  advertisingCost: { toNumber?: () => number } | number | string;
  otherCosts: { toNumber?: () => number } | number | string;
  netRevenue: { toNumber?: () => number } | number | string;
  currency: string;
  referenceNote: string;
}): RevenueEntry {
  return {
    id: row.id,
    date: iso(row.date)!,
    productId: row.productId,
    opportunityId: row.opportunityId,
    revenueSource: row.revenueSource,
    grossRevenue: decimalToNumber(row.grossRevenue),
    fees: decimalToNumber(row.fees),
    advertisingCost: decimalToNumber(row.advertisingCost),
    otherCosts: decimalToNumber(row.otherCosts),
    netRevenue: decimalToNumber(row.netRevenue),
    currency: row.currency,
    referenceNote: row.referenceNote,
  };
}

export function mapAgent(row: {
  id: string;
  name: string;
  type: Agent["type"];
  description: string;
  status: Agent["status"];
  lastRun: Date | string | null;
  placeholder: boolean;
}): Agent {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    status: row.status,
    lastRun: iso(row.lastRun),
    placeholder: row.placeholder,
  };
}

export function mapResearchRun(row: {
  id: string;
  opportunityId: string;
  status: ResearchRun["status"];
  startedAt: Date | string;
  completedAt: Date | string | null;
  confidence: { toNumber?: () => number } | number | string;
  conclusion?: string | null;
  conclusionBasis?: string | null;
  providersAttempted: string[];
  providersSucceeded: string[];
  providerStatuses?: unknown;
  validationSignals?: unknown;
  scoreIntegration?: unknown;
  errors: string[];
  queries: Array<{ query: string; source: string; purpose: string }>;
  evidence: Array<{
    id: string;
    source: string;
    title: string;
    url: string;
    snippet: string;
    collectedAt: Date | string;
    relevanceScore: { toNumber?: () => number } | number | string;
    qualityScore: { toNumber?: () => number } | number | string;
    hash: string;
    supports: string[];
    contradicts: string[];
    dataClass?: string | null;
  }>;
  findings: Array<{
    id: string;
    claim: string;
    summary: string;
    confidence: { toNumber?: () => number } | number | string;
    evidenceIds: string[];
    contradictions: string[];
  }>;
}): ResearchRun {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    status: row.status,
    startedAt: iso(row.startedAt)!,
    completedAt: iso(row.completedAt),
    queries: row.queries.map((q): ResearchQuery => ({
      query: q.query,
      source: q.source,
      purpose: q.purpose as ResearchQuery["purpose"],
    })),
    evidence: row.evidence.map((item): Evidence => ({
      id: item.id,
      source: item.source,
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      collectedAt: iso(item.collectedAt)!,
      relevanceScore: decimalToNumber(item.relevanceScore),
      qualityScore: decimalToNumber(item.qualityScore),
      hash: item.hash,
      supports: item.supports as Evidence["supports"],
      contradicts: item.contradicts,
      dataClass: (item.dataClass ?? "REAL_LIVE_DATA") as EvidenceDataClass,
    })),
    findings: row.findings.map((item): ResearchFinding => ({
      id: item.id,
      claim: item.claim,
      summary: item.summary,
      confidence: decimalToNumber(item.confidence),
      evidenceIds: item.evidenceIds,
      contradictions: item.contradictions,
    })),
    validationSignals: jsonValue<ValidationSignal[]>(row.validationSignals, []),
    confidence: decimalToNumber(row.confidence),
    conclusion: (row.conclusion ?? "INSUFFICIENT_EVIDENCE") as ResearchConclusion,
    conclusionBasis: row.conclusionBasis ?? "",
    providersAttempted: row.providersAttempted,
    providersSucceeded: row.providersSucceeded,
    providerStatuses: jsonValue<ProviderRunStatus[]>(row.providerStatuses, []),
    scoreIntegration: jsonValue<ScoreIntegration>(row.scoreIntegration, {
      suggestedOverallScore: null,
      factors: [],
    }),
    errors: row.errors,
  };
}

/**
 * Map a persisted Validation row (one per research run) back to the typed
 * PersistedValidation shape. Each signal keeps its evidence ids so validation
 * stays traceable to evidence end to end.
 */
export function mapValidation(row: {
  id: string;
  researchRunId: string;
  demandStatus: SignalStatus;
  demandEvidenceIds: string[];
  painPointStatus: SignalStatus;
  painPointEvidenceIds: string[];
  commercialIntentStatus: SignalStatus;
  commercialIntentEvidenceIds: string[];
  trendStatus: SignalStatus;
  trendEvidenceIds: string[];
  competitionStatus: SignalStatus;
  competitionEvidenceIds: string[];
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  confidence: { toNumber?: () => number } | number | string;
  conclusion: string;
  conclusionBasis: string;
  createdAt: Date | string;
}): PersistedValidation {
  const signals: ValidationSignal[] = [
    { key: "demand", label: "Demand", status: row.demandStatus, evidenceIds: row.demandEvidenceIds, basis: "persisted signal" },
    { key: "pain-point", label: "Pain Point", status: row.painPointStatus, evidenceIds: row.painPointEvidenceIds, basis: "persisted signal" },
    { key: "commercial-intent", label: "Commercial Intent", status: row.commercialIntentStatus, evidenceIds: row.commercialIntentEvidenceIds, basis: "persisted signal" },
    { key: "trend", label: "Trend", status: row.trendStatus, evidenceIds: row.trendEvidenceIds, basis: "persisted signal" },
    { key: "competition", label: "Competition", status: row.competitionStatus, evidenceIds: row.competitionEvidenceIds, basis: "persisted signal" },
  ];
  return {
    id: row.id,
    researchRunId: row.researchRunId,
    signals,
    evidenceCoverage: row.evidenceCoverage,
    sourceDiversity: row.sourceDiversity,
    contradictionCount: row.contradictionCount,
    confidence: decimalToNumber(row.confidence),
    conclusion: row.conclusion as ResearchConclusion,
    conclusionBasis: row.conclusionBasis,
    createdAt: iso(row.createdAt)!,
  };
}

/** Map a persisted Handoff row to the typed contract shape. */
export function mapHandoff(row: {
  id: string;
  opportunityId: string;
  contractVersion: number;
  contract: unknown;
  status: string;
  validationConclusion: string | null;
  confidence: { toNumber?: () => number } | number | string | null;
  score: { toNumber?: () => number } | number | string | null;
  recommendedExperiment: string;
  experimentHypothesis: string;
  successCriteria: unknown;
  budgetLimit: { toNumber?: () => number } | number | string | null;
  timeLimitDays: number | null;
  acceptedAt: Date | string | null;
  rejectedAt: Date | string | null;
  rejectionReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): HandoffRecord {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    contractVersion: row.contractVersion,
    contract: jsonValue<OpportunityHandoffContract>(row.contract, {
      contractVersion: 1,
      handoffId: row.id,
      opportunityId: row.opportunityId,
      title: "",
      category: "",
      targetAudience: "",
      problem: "",
      validationConclusion: null,
      confidence: null,
      score: null,
      evidence: [],
      monetizationOptions: [],
      risks: [],
      recommendedExperiment: "MVP_BUILD",
      experimentHypothesis: row.experimentHypothesis,
      successCriteria: stringArray(row.successCriteria),
      budgetLimit: row.budgetLimit === null ? null : decimalToNumber(row.budgetLimit),
      timeLimitDays: row.timeLimitDays,
      handoffStatus: row.status as OpportunityHandoffContract["handoffStatus"],
    }),
    status: row.status as HandoffRecord["status"],
    validationConclusion: (row.validationConclusion ?? null) as HandoffRecord["validationConclusion"],
    confidence: row.confidence === null ? null : decimalToNumber(row.confidence),
    score: row.score === null ? null : decimalToNumber(row.score),
    recommendedExperiment: row.recommendedExperiment as HandoffRecord["recommendedExperiment"],
    experimentHypothesis: row.experimentHypothesis,
    successCriteria: stringArray(row.successCriteria),
    budgetLimit: row.budgetLimit === null ? null : decimalToNumber(row.budgetLimit),
    timeLimitDays: row.timeLimitDays,
    acceptedAt: iso(row.acceptedAt),
    rejectedAt: iso(row.rejectedAt),
    rejectionReason: row.rejectionReason,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

/** Map a persisted AgentRun row to the app-level AgentRunRecord shape. */
export function mapAgentRun(row: {
  id: string;
  agentId: string;
  task: string;
  status: AgentRunRecord["status"];
  startedAt: Date | string;
  completedAt: Date | string | null;
  input: unknown;
  output: unknown;
  errors: string[];
  metadata: unknown;
  createdAt: Date | string;
}): AgentRunRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    task: row.task,
    status: row.status,
    startedAt: iso(row.startedAt)!,
    completedAt: iso(row.completedAt),
    input: row.input ?? null,
    output: row.output ?? null,
    errors: row.errors,
    metadata: row.metadata ?? null,
    createdAt: iso(row.createdAt)!,
  };
}

export function opportunityCreateData(item: Omit<Opportunity, "id" | "createdAt" | "updatedAt">, id?: string) {
  return {
    ...(id ? { id } : {}),
    title: item.title,
    category: item.category,
    businessModel: item.businessModel,
    targetAudience: item.targetAudience,
    problemSolved: item.problemSolved,
    monetizationMethod: item.monetizationMethod,
    estimatedStartupCost: item.estimatedStartupCost,
    demandScore: item.demandScore,
    competitionScore: item.competitionScore,
    commercialIntentScore: item.commercialIntentScore,
    automationScore: item.automationScore,
    differentiationScore: item.differentiationScore,
    monetizationStrengthScore: item.monetizationStrengthScore,
    halalScore: item.halalScore,
    halalStatus: item.halalStatus,
    overallScore: item.overallScore,
    confidence: item.confidence,
    status: item.status,
    evidence: item.evidence,
    risks: item.risks,
    nextAction: item.nextAction,
    isSample: false,
  };
}
