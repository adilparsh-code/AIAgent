/**
 * Phase 27 regression tests — per-experiment metric bounds in the Phase 26
 * revenue intelligence service. Uses a stubbed Prisma surface (no real
 * database): the unit under test only needs experiment.findMany +
 * agentTask.findMany, and a real DB cannot produce >200 rows cheaply enough
 * to exercise the bound. Fixtures are TEST DATA and never REAL_DATA.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const prismaStub = vi.hoisted(() => ({
  experiment: { findMany: vi.fn() },
  agentTask: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => prismaStub,
}));

import { getRevenueIntelligence, REVENUE_INTELLIGENCE_BOUNDS } from "@/lib/server/revenue-intelligence-service";

const NOW = new Date("2026-09-26T00:00:00.000Z");

function metricRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-02T00:00:00.000Z"),
    recordedAt: new Date("2026-09-02T12:00:00.000Z"),
    impressions: 100,
    clicks: 10,
    visits: 50,
    leads: 5,
    conversions: 2,
    revenue: 25.5,
    cost: null,
    currency: "USD",
    source: "test-fixture",
    dataClass: "REAL_DATA",
    notes: "",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Phase 27: per-experiment metric bounds in revenue intelligence", () => {
  it("reads every experiment's metrics via the per-experiment include (no global take)", async () => {
    prismaStub.experiment.findMany.mockResolvedValue([
      {
        id: "exp-a",
        opportunityId: "opp-1",
        status: "RUNNING",
        decision: null,
        _count: { metricEvents: 2 },
        metricEvents: [metricRow(), metricRow({ revenue: 10 })],
      },
      {
        id: "exp-b",
        opportunityId: "opp-2",
        status: "READY",
        decision: null,
        _count: { metricEvents: 1 },
        metricEvents: [metricRow({ revenue: 99 })],
      },
    ]);
    prismaStub.agentTask.findMany.mockResolvedValue([]);

    const state = await getRevenueIntelligence("user-1", NOW);

    // The metrics load rides ON the experiment query (per-experiment include),
    // never a separate unbounded-by-experiment global query.
    const call = prismaStub.experiment.findMany.mock.calls[0][0] as {
      select?: { metricEvents?: { take?: number }; _count?: unknown };
    };
    expect(call?.select?.metricEvents?.take).toBe(REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT);
    expect(call?.select?._count).toBeDefined();

    // Both experiments keep their own real data — no cross-experiment starvation.
    const a = state.experiments.find((row) => row.experimentId === "exp-a");
    const b = state.experiments.find((row) => row.experimentId === "exp-b");
    expect(a?.financial.revenue).toBeCloseTo(35.5);
    expect(b?.financial.revenue).toBeCloseTo(99);
    expect(state.portfolioTotals.realRevenue).toBeCloseTo(134.5);
    expect(state.truncated).toBe(false);
  });

  it("flags truncation honestly when one experiment exceeds the per-experiment cap", async () => {
    prismaStub.experiment.findMany.mockResolvedValue([
      {
        id: "exp-huge",
        opportunityId: "opp-1",
        status: "RUNNING",
        decision: null,
        _count: { metricEvents: REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT + 7 },
        metricEvents: Array.from({ length: REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT }, () =>
          metricRow({ revenue: 1 }),
        ),
      },
    ]);
    prismaStub.agentTask.findMany.mockResolvedValue([]);

    const state = await getRevenueIntelligence("user-1", NOW);
    expect(state.truncated).toBe(true);
    // Rows actually read stay at the bound.
    const huge = state.experiments.find((row) => row.experimentId === "exp-huge");
    expect(huge?.recordCount).toBe(REVENUE_INTELLIGENCE_BOUNDS.MAX_METRIC_ROWS_PER_EXPERIMENT);
  });

  it("keeps owner isolation: the queries filter by the caller's ownerId and exclude samples", async () => {
    prismaStub.experiment.findMany.mockResolvedValue([]);
    prismaStub.agentTask.findMany.mockResolvedValue([]);

    await getRevenueIntelligence("user-42", NOW);

    const experimentCall = prismaStub.experiment.findMany.mock.calls[0][0] as {
      where?: { opportunity?: { ownerId?: string; isSample?: boolean } };
    };
    expect(experimentCall?.where?.opportunity?.ownerId).toBe("user-42");
    expect(experimentCall?.where?.opportunity?.isSample).toBe(false);

    const taskCall = prismaStub.agentTask.findMany.mock.calls[0][0] as {
      where?: { ownerId?: string; status?: { in?: string[] } };
    };
    expect(taskCall?.where?.ownerId).toBe("user-42");
    expect(taskCall?.where?.status?.in).toEqual(["WAITING_APPROVAL", "BLOCKED"]);
  });
});
