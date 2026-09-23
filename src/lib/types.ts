// Opportunity Types
export type OpportunityStatus =
  | "IDEA"
  | "RESEARCHING"
  | "VALIDATING"
  | "VALIDATED"
  | "BUILDING"
  | "PUBLISHED"
  | "EARNING"
  | "SCALING"
  | "PAUSED"
  | "REJECTED";

export type HalalStatus = "HALAL" | "REVIEW_REQUIRED" | "NOT_ALLOWED";

export type BusinessModel =
  | "DIGITAL_PRODUCT"
  | "AFFILIATE"
  | "SAAS"
  | "PRINTABLE"
  | "EDUCATIONAL"
  | "MARKETPLACE";

export type Category =
  | "CHILDRENS_BOOKS"
  | "EDUCATIONAL_RESOURCES"
  | "TEACHER_RESOURCES"
  | "PRINTABLES"
  | "AFFILIATE"
  | "DIGITAL_TOOLS"
  | "SAAS";

export interface ScoreBreakdown {
  demand: number;
  commercialIntent: number;
  competitionOpportunity: number;
  startupCost: number;
  automationPotential: number;
  differentiation: number;
  monetizationStrength: number;
  halalCompliance: number;
}

export interface Opportunity {
  id: string;
  title: string;
  category: Category;
  businessModel: BusinessModel;
  targetAudience: string;
  problemSolved: string;
  monetizationMethod: string;
  estimatedStartupCost: number;
  demandScore: number;
  competitionScore: number;
  commercialIntentScore: number;
  automationScore: number;
  differentiationScore: number;
  monetizationStrengthScore: number;
  halalScore: number;
  halalStatus: HalalStatus;
  overallScore: number;
  confidence: number;
  status: OpportunityStatus;
  evidence: string[];
  risks: string[];
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

// Product Types
export type ProductType =
  | "COLORING_BOOK"
  | "DRAWING_BOOK"
  | "ACTIVITY_BOOK"
  | "WORKSHEET"
  | "WORKBOOK"
  | "PRINTABLE"
  | "TEACHER_RESOURCE"
  | "DIGITAL_TOOL"
  | "AFFILIATE_WEBSITE"
  | "SAAS";

export type ProductStatus =
  | "PLANNED"
  | "IN_DEVELOPMENT"
  | "READY"
  | "PUBLISHED"
  | "PAUSED"
  | "RETIRED";

export interface ProductMetrics {
  views?: number;
  downloads?: number;
  sales?: number;
  revenue?: number;
  rating?: number;
}

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  targetAudience: string;
  opportunityId: string | null;
  status: ProductStatus;
  price: number;
  cost: number;
  revenue: number;
  platform: string;
  productUrl: string | null;
  affiliateUrl: string | null;
  metrics: ProductMetrics;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// Experiment Types
// Legacy values (SCALE/ITERATE/PAUSE/KILL) are preserved for existing rows/UI;
// Phase 5 adds the data-driven decision vocabulary (WIN/ITERATE/STOP/INSUFFICIENT_DATA).
export type ExperimentDecision =
  | "SCALE"
  | "ITERATE"
  | "PAUSE"
  | "KILL"
  | "WIN"
  | "STOP"
  | "INSUFFICIENT_DATA";

export type ExperimentStatus =
  | "PLANNED"
  | "READY"
  | "RUNNING"
  | "ACTIVE"
  | "COMPLETED"
  | "STOPPED"
  | "ITERATING"
  | "FAILED"
  | "PAUSED";

export interface Experiment {
  id: string;
  hypothesis: string;
  opportunityId: string;
  target: string;
  budget: number;
  startDate: string;
  endDate: string | null;
  expectedResult: string;
  actualResult: string | null;
  visitors: number;
  leads: number;
  clicks: number;
  sales: number;
  revenue: number;
  profit: number;
  conversionRate: number;
  decision: ExperimentDecision | null;
  status: ExperimentStatus;
  // Phase 5 fields — optional so existing rows and UI keep working.
  objective?: string | null;
  successCriteria?: string[];
  metrics?: ExperimentMetricsRecord | null;
  result?: string | null;
  notes?: string | null;
  feedback?: ExperimentFeedbackRecord | null;
  handoffId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Recorded experiment metrics; absent keys are genuinely missing — never faked. */
export interface ExperimentMetricsRecord {
  impressions?: number;
  clicks?: number;
  visits?: number;
  leads?: number;
  conversions?: number;
  revenue?: number;
  cost?: number;
}

/** Structured feedback returned to AIAgent after an experiment completes. */
export interface ExperimentFeedbackRecord {
  opportunityId: string;
  experimentId: string;
  actualMetrics: ExperimentMetricsRecord;
  actualRevenue: number | null;
  actualCost: number | null;
  actualProfit: number | null;
  decision: "WIN" | "ITERATE" | "STOP" | "INSUFFICIENT_DATA";
  lessons: string[];
  evidenceGenerated: string[];
  recommendationForFutureResearch: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA";
}

// Revenue Types
export type RevenueSource =
  | "PRODUCT_SALES"
  | "AFFILIATE_COMMISSION"
  | "SAAS_SUBSCRIPTION"
  | "ADS"
  | "OTHER";

export interface RevenueEntry {
  id: string;
  date: string;
  productId?: string | null;
  opportunityId: string | null;
  revenueSource: RevenueSource;
  grossRevenue: number;
  fees: number;
  advertisingCost: number;
  otherCosts: number;
  netRevenue: number;
  currency: string;
  referenceNote: string;
}

// Agent Types (placeholder for future)
export type AgentType =
  | "RESEARCH"
  | "VALIDATION"
  | "PRODUCT"
  | "AFFILIATE"
  | "SEO"
  | "QA"
  | "ANALYTICS"
  | "GROWTH"
  | "BUSINESS_MANAGER";

export type AgentStatus = "ACTIVE" | "IDLE" | "ERROR" | "DISABLED";

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  description: string;
  status: AgentStatus;
  lastRun: string | null;
  placeholder: boolean;
}

// Agent Run Types (Phase 2 persistence — no agent executes anything yet)
export type AgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface AgentRunRecord {
  id: string;
  agentId: string;
  task: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string | null;
  input: unknown;
  output: unknown;
  errors: string[];
  metadata: unknown;
  createdAt: string;
}

// Dashboard Metrics
export interface DashboardMetrics {
  totalOpportunities: number;
  validatedOpportunities: number;
  activeExperiments: number;
  totalProducts: number;
  publishedProducts: number;
  totalRevenue: number;
  monthlyRevenue: number;
}

// Handoff (Phase 5): stable machine-readable contract between AIAgent and AI Income Lab.
import type {
  HandoffStatus,
  OpportunityHandoffContract,
  HandoffRecommendedExperimentType,
} from "./handoff";
export type {
  HandoffStatus,
  HandoffEligibility,
  HandoffIneligibilityReason,
  OpportunityHandoffContract,
  HandoffEvidenceRef,
  HandoffMonetizationOption,
  HandoffRecommendedExperimentType,
} from "./handoff";

/** Persisted handoff row as exposed to the UI/API layer. */
export interface HandoffRecord {
  id: string;
  opportunityId: string;
  contractVersion: number;
  contract: OpportunityHandoffContract;
  status: HandoffStatus;
  validationConclusion: ResearchConclusionRef;
  confidence: number | null;
  score: number | null;
  recommendedExperiment: HandoffRecommendedExperimentType;
  experimentHypothesis: string;
  successCriteria: string[];
  budgetLimit: number | null;
  timeLimitDays: number | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export type { ExperimentMetrics, ExperimentFeedback } from "./experiment-evaluation";

/** Local alias so types.ts does not import from research-types at runtime. */
type ResearchConclusionRef = import("./research-types").ResearchConclusion;

// Navigation
export interface NavItem {
  title: string;
  href: string;
  icon: string;
}