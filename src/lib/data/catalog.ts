import type { Product, Experiment, RevenueEntry, Agent, DashboardMetrics } from "../types";

// SAMPLE DATA — illustrative only, not live metrics.

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: "prod-001",
    name: "Animals Coloring Book for Kids",
    type: "COLORING_BOOK",
    targetAudience: "Children ages 3-6",
    opportunityId: "opp-001",
    status: "PUBLISHED",
    price: 4.99,
    cost: 0,
    revenue: 247.5,
    platform: "Amazon KDP",
    productUrl: null,
    affiliateUrl: null,
    metrics: { sales: 50, rating: 4.3 },
    notes: "SAMPLE DATA — first published product",
    createdAt: "2025-01-20T10:00:00Z",
    updatedAt: "2025-01-25T10:00:00Z",
  },
  {
    id: "prod-002",
    name: "Shapes & Patterns Activity Book",
    type: "ACTIVITY_BOOK",
    targetAudience: "Children ages 4-7",
    opportunityId: "opp-001",
    status: "IN_DEVELOPMENT",
    price: 5.99,
    cost: 0,
    revenue: 0,
    platform: "Amazon KDP",
    productUrl: null,
    affiliateUrl: null,
    metrics: {},
    notes: "SAMPLE DATA — in progress",
    createdAt: "2025-01-22T10:00:00Z",
    updatedAt: "2025-01-22T10:00:00Z",
  },
];

export const SAMPLE_EXPERIMENTS: Experiment[] = [
  {
    id: "exp-001",
    hypothesis: "An animal-themed coloring book sells 20+ copies in its first month on Amazon KDP",
    opportunityId: "opp-001",
    target: "20 sales in 30 days",
    budget: 0,
    startDate: "2025-01-20T00:00:00Z",
    endDate: "2025-02-20T00:00:00Z",
    expectedResult: "20 sales, about $100 revenue",
    actualResult: "SAMPLE DATA — 50 sales, $247.50 revenue, exceeded target",
    visitors: 0,
    leads: 0,
    clicks: 0,
    sales: 50,
    revenue: 247.5,
    profit: 247.5,
    conversionRate: 0,
    decision: "SCALE",
    status: "COMPLETED",
    createdAt: "2025-01-20T00:00:00Z",
    updatedAt: "2025-02-20T00:00:00Z",
  },
];

export const SAMPLE_REVENUE: RevenueEntry[] = [
  {
    id: "rev-001",
    date: "2025-01-25T00:00:00Z",
    productId: "prod-001",
    opportunityId: "opp-001",
    revenueSource: "PRODUCT_SALES",
    grossRevenue: 125,
    fees: 37.5,
    advertisingCost: 0,
    otherCosts: 0,
    netRevenue: 87.5,
    currency: "USD",
    referenceNote: "SAMPLE DATA — KDP royalties, January week 4",
  },
  {
    id: "rev-002",
    date: "2025-01-31T00:00:00Z",
    productId: "prod-001",
    opportunityId: "opp-001",
    revenueSource: "PRODUCT_SALES",
    grossRevenue: 122.5,
    fees: 36.75,
    advertisingCost: 0,
    otherCosts: 0,
    netRevenue: 85.75,
    currency: "USD",
    referenceNote: "SAMPLE DATA — KDP royalties, January week 5",
  },
];

function agent(id: string, name: string, type: Agent["type"], description: string): Agent {
  return { id, name, type, description, status: "DISABLED", lastRun: null, placeholder: true };
}

export const SAMPLE_AGENTS: Agent[] = [
  agent("agent-001", "Research Agent", "RESEARCH", "Discovers opportunities. PLANNED INTEGRATION — not connected."),
  agent("agent-002", "Validation Agent", "VALIDATION", "Scores opportunities. PLANNED INTEGRATION — not connected."),
  agent("agent-003", "Product Agent", "PRODUCT", "Drafts product plans. PLANNED INTEGRATION — not connected."),
  agent("agent-004", "Affiliate Agent", "AFFILIATE", "Researches legitimate affiliate programs. PLANNED INTEGRATION."),
  agent("agent-005", "SEO Agent", "SEO", "Search optimization guidance. PLANNED INTEGRATION — not connected."),
  agent("agent-006", "QA Agent", "QA", "Quality and compliance checks. PLANNED INTEGRATION — not connected."),
  agent("agent-007", "Analytics Agent", "ANALYTICS", "Traffic and revenue analysis. PLANNED INTEGRATION."),
  agent("agent-008", "Growth Agent", "GROWTH", "Scale recommendations. PLANNED INTEGRATION — not connected."),
  agent("agent-009", "Business Manager", "BUSINESS_MANAGER", "Coordinates agents. PLANNED INTEGRATION."),
];

export const SAMPLE_METRICS: DashboardMetrics = {
  totalOpportunities: 6,
  validatedOpportunities: 1,
  activeExperiments: 0,
  totalProducts: 2,
  publishedProducts: 1,
  totalRevenue: 247.5,
  monthlyRevenue: 173.25,
};
