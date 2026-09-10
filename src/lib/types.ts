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
export type ExperimentDecision =
  | "SCALE"
  | "ITERATE"
  | "PAUSE"
  | "KILL";

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
  status: "ACTIVE" | "COMPLETED" | "PAUSED";
  createdAt: string;
  updatedAt: string;
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
  productId: string | null;
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

// Navigation
export interface NavItem {
  title: string;
  href: string;
  icon: string;
}
