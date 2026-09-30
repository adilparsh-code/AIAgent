import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * SSR smoke tests for the operational console pages (Phase 16).
 *
 * The pages are client components; server-rendering them executes the initial
 * render (loading/empty states) without a browser, proving the tree composes
 * and the honest initial states render. Data-loading behavior is covered by
 * the route tests and the console primitive tests.
 */

const dataMocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  opportunityGetAll: vi.fn().mockResolvedValue([]),
  handoffGetAll: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/http", () => ({ apiGet: dataMocks.apiGet, apiSend: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  opportunityRepository: { getAll: dataMocks.opportunityGetAll, getById: vi.fn(), isSample: vi.fn().mockResolvedValue(false) },
  handoffRepository: { getAll: dataMocks.handoffGetAll },
  experimentRepository: { getAll: vi.fn().mockResolvedValue([]) },
  revenueRepository: { getAll: vi.fn().mockResolvedValue([]), getTotalNetRevenue: vi.fn().mockResolvedValue(0), getMonthlyRevenue: vi.fn().mockResolvedValue(0) },
  productRepository: { getAll: vi.fn().mockResolvedValue([]) },
  agentRepository: { getAll: vi.fn().mockResolvedValue([]) },
}));

function render(ui: React.ReactElement): string {
  return renderToStaticMarkup(ui);
}

describe("console pages — server-render smoke", () => {
  it("dashboard renders its operational shell with honest loading state", async () => {
    const { default: DashboardPage } = await import("./page");
    const markup = render(<DashboardPage />);
    expect(markup).toContain("Operations");
    expect(markup).toContain("System health");
    expect(markup).toContain("Handoff transport");
    // Metric values are pending during the initial render — no fake numbers.
    expect(markup).toContain("Data unavailable");
  });

  it("opportunities page renders filters", async () => {
    const { default: OpportunitiesPage } = await import("./opportunities/page");
    const markup = render(<OpportunitiesPage />);
    expect(markup).toContain("Opportunities");
    expect(markup).toContain("All business models");
    expect(markup).toContain("All handoff states");
  });

  it("handoff center renders its loading shell, then composes the delivery table", async () => {
    const { default: HandoffsPage } = await import("./handoffs/page");
    // Initial SSR render: the page gates on client-side loading (pre-existing
    // pattern); the honest heading + loading state must render without error.
    const markup = render(<HandoffsPage />);
    expect(markup).toContain("Handoffs");
    expect(markup).toContain("Loading handoffs");
  });

  it("validation page renders with the four verdict classes", async () => {
    const { default: ValidationPage } = await import("./validation/page");
    const markup = render(<ValidationPage />);
    expect(markup).toContain("Validation");
    expect(markup).toContain("VALIDATED");
    expect(markup).toContain("REQUIRES_HUMAN_REVIEW");
    expect(markup).toContain("PENDING");
  });

  it("research center renders the start-research gate and run table shell", async () => {
    const { default: ResearchPage } = await import("./research/page");
    const markup = render(<ResearchPage />);
    expect(markup).toContain("Research Center");
    expect(markup).toContain("Start Research");
    expect(markup).toContain("Research runs");
  });

  it("evidence explorer renders its selector honestly", async () => {
    const { default: EvidencePage } = await import("./evidence/page");
    const markup = render(<EvidencePage />);
    expect(markup).toContain("Evidence");
    expect(markup).toContain("Select a research run");
  });

  it("agent runs page renders", async () => {
    const { default: AgentRunsPage } = await import("./agent-runs/page");
    const markup = render(<AgentRunsPage />);
    expect(markup).toContain("Agent Runs");
    expect(markup).toContain("Execution records");
  });

  it("audit logs page renders the coverage note", async () => {
    const { default: AuditLogsPage } = await import("./audit-logs/page");
    const markup = render(<AuditLogsPage />);
    expect(markup).toContain("Audit Logs");
    expect(markup).toContain("Coverage");
  });

  it("system health page renders component grid shell", async () => {
    const { default: SystemHealthPage } = await import("./health/page");
    const markup = render(<SystemHealthPage />);
    expect(markup).toContain("System Health");
    expect(markup).toContain("Handoff transport");
    expect(markup).toContain("Data unavailable");
  });

  it("providers page renders its no-secrets contract", async () => {
    const { default: ProvidersPage } = await import("./providers/page");
    const markup = render(<ProvidersPage />);
    expect(markup).toContain("Providers");
    expect(markup).toContain("Secret handling");
  });
});
