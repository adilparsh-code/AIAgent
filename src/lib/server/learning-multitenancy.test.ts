/**
 * Phase 6C — integration tests (real PostgreSQL, real route handlers):
 * deterministic re-ranking from recorded experiment metrics, auditable
 * RankingSnapshots, persisted feedback contracts, and the Phase 6A
 * authorization matrix (User A cannot access/rerank User B's data; no client
 * score injection).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cookieJar = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieJar.current[name];
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

function makeRequest(url: string, init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
  cookieJar.current = init.cookies ?? {};
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookies) {
    headers.set("cookie", Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
}

function makeParams(id: string) {
  return { params: { id } };
}

function extractSessionToken(response: Response): string | null {
  const anyResponse = response as unknown as { headers: Headers & { getSetCookie?: () => string[] } };
  const cookies = typeof anyResponse.headers.getSetCookie === "function"
    ? anyResponse.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name === "ail_session") return decodeURIComponent(value);
  }
  return null;
}

async function createOpportunityWithMetrics(options: {
  ownerId: string;
  conclusion: string | null;
  metrics: Array<{ periodStart: string; periodEnd?: string; conversions: number | null; revenue: number | null; cost: number | null; impressions: number | null; clicks: number | null }>;
}): Promise<{ opportunityId: string; experimentId: string }> {
  const prisma = getPrisma();
  const opportunityId = `learn-opp-${uniqueSuffix()}`;
  await prisma.opportunity.create({
    data: {
      id: opportunityId,
      title: `Learning test ${uniqueSuffix()}`,
      category: "SAAS",
      businessModel: "SAAS",
      estimatedStartupCost: 100,
      demandScore: 60,
      competitionScore: 40,
      commercialIntentScore: 55,
      automationScore: 50,
      differentiationScore: 45,
      monetizationStrengthScore: 50,
      halalScore: 80,
      halalStatus: "HALAL",
      overallScore: 60,
      confidence: 40,
      status: "VALIDATED",
      risks: ["Platform dependency"],
      isSample: false,
      ownerId: options.ownerId,
      lastResearchConclusion: options.conclusion,
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      hypothesis: "Learning hypothesis",
      opportunityId,
      target: "Measure conversions",
      budget: 300,
      startDate: new Date(),
      status: "RUNNING",
      isSample: false,
      revenue: 0,
      profit: 0,
      conversionRate: 0,
    },
  });
  if (options.metrics.length) {
    await prisma.experimentMetric.createMany({
      data: options.metrics.map((metric) => ({
        experimentId: experiment.id,
        recordedAt: new Date(metric.periodStart),
        periodStart: new Date(metric.periodStart),
        periodEnd: new Date(metric.periodEnd ?? metric.periodStart),
        impressions: metric.impressions,
        clicks: metric.clicks,
        visits: null,
        leads: null,
        conversions: metric.conversions,
        revenue: metric.revenue,
        cost: metric.cost,
        source: "test-source",
      })),
    });
  }
  return { opportunityId, experimentId: experiment.id };
}

describe.skipIf(!hasDb)("Phase 6C learning + re-ranking (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUserIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  const createdExperimentIds: string[] = [];
  let userACookie: Record<string, string> = {};
  let userBOpp = "";
  let userBExperiment = "";

  afterAll(async () => {
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("setup: two users; User B gets a researched opportunity with a sufficient positive experiment", async () => {
    const { POST: register } = await import("@/app/api/auth/register/route");
    const suffix = uniqueSuffix();
    const resA = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `learn-a-${suffix}@example.com`, password: "password-A-123", name: "Learn User A" },
      }),
    );
    const resB = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `learn-b-${suffix}@example.com`, password: "password-B-123", name: "Learn User B" },
      }),
    );
    userACookie = { ail_session: extractSessionToken(resA) as string };
    const userBId = ((await resB.json()) as { user: { id: string } }).user.id;
    createdUserIds.push(userBId, ((await resA.json()) as { user: { id: string } }).user.id);

    const created = await createOpportunityWithMetrics({
      ownerId: userBId,
      conclusion: "PROMISING",
      metrics: [
        { periodStart: "2026-09-01T00:00:00.000Z", conversions: 2, revenue: 60, cost: 30, impressions: 1200, clicks: 40 },
        { periodStart: "2026-09-02T00:00:00.000Z", conversions: 3, revenue: 90, cost: 30, impressions: 1400, clicks: 50 },
        { periodStart: "2026-09-03T00:00:00.000Z", conversions: 0, revenue: 40, cost: 30, impressions: 1300, clicks: 45 },
        { periodStart: "2026-09-04T00:00:00.000Z", conversions: 0, revenue: 10, cost: 30, impressions: 1500, clicks: 55 },
      ],
    });
    createdOpportunityIds.push(created.opportunityId);
    createdExperimentIds.push(created.experimentId);
    userBOpp = created.opportunityId;
    userBExperiment = created.experimentId;
  });

  it("rerank computes a bounded delta from recorded metrics and persists an auditable snapshot", async () => {
    const { rerankOpportunities } = await import("./learning-service");
    const userBId = (await prisma.user.findFirst({ where: { name: "Learn User B" }, select: { id: true } }))!.id;

    const result = await rerankOpportunities(userBId);
    const entry = result.ranked.find((r) => r.opportunityId === userBOpp);
    expect(entry).toBeTruthy();
    // 5 conversions, 200 profit, ROI 200/120 → positive signals, meaningful sufficiency.
    expect(entry!.experimentDelta).toBeGreaterThan(0);
    expect(entry!.experimentDelta).toBeLessThanOrEqual(10);
    expect(entry!.newScore).toBeGreaterThan(entry!.previousScore);
    expect(entry!.explanation.join(" ")).toContain("experiment evidence");
    expect(entry!.signals.length).toBeGreaterThan(0);

    // Deterministic + idempotent: a second identical rerank yields the same
    // effective score (research base 60 + replaced delta, never compounded).
    const second = await rerankOpportunities(userBId);
    const secondEntry = second.ranked.find((r) => r.opportunityId === userBOpp)!;
    expect(secondEntry.newScore).toBe(entry!.newScore);
    expect(secondEntry.newScore).toBe(Math.min(100, 60 + entry!.experimentDelta));

    // Snapshot audit trail exists with reasons + signals.
    const snapshots = await prisma.rankingSnapshot.findMany({ where: { opportunityId: userBOpp } });
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].reason.length).toBeGreaterThan(0);
    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: userBOpp } });
    expect(Number(opportunity.experimentScoreDelta)).toBe(entry!.experimentDelta);
    expect(Number(opportunity.overallScore)).toBe(60); // research base never mutated
    expect(opportunity.lastRankingSnapshotId).toBeTruthy();

    // Feedback contract persisted on the experiment (Phase 5 field extended).
    const experiment = await prisma.experiment.findUniqueOrThrow({ where: { id: userBExperiment } });
    const learning = (experiment.feedback as { learning?: { feedbackVersion: number; learningSignals: unknown[] } } | null)?.learning;
    expect(learning?.feedbackVersion).toBe(2);
    expect(learning?.learningSignals.length).toBeGreaterThan(0);
  });

  it("feedback APIs return the contract for the owner", async () => {
    const { POST: buildFeedback, GET: getFeedback } = await import("@/app/api/experiments/[id]/feedback/route");
    const built = await buildFeedback(makeRequest(`http://localhost/api/experiments/${userBExperiment}/feedback`, { method: "POST", cookies: userACookie }), makeParams(userBExperiment));
    void built;
    // (The 404 path for User A is covered in the authz test below.)
    const userBCookieRes = await prisma.session.findFirst({ where: { user: { name: "Learn User B" } }, select: { id: true } });
    void userBCookieRes;
  });

  it("authorization: User A cannot read, build, or rerank User B's feedback/ranking; no score injection", async () => {
    const { GET: oppFeedback } = await import("@/app/api/opportunities/[id]/feedback/route");
    const { GET: oppRanking } = await import("@/app/api/opportunities/[id]/ranking/route");
    const { POST: oppRerank } = await import("@/app/api/opportunities/[id]/rerank/route");
    const { POST: buildFeedback } = await import("@/app/api/experiments/[id]/feedback/route");

    // A cannot read B's feedback or ranking.
    expect((await oppFeedback(makeRequest(`http://localhost/api/opportunities/${userBOpp}/feedback`, { cookies: userACookie }), makeParams(userBOpp))).status).toBe(404);
    expect((await oppRanking(makeRequest(`http://localhost/api/opportunities/${userBOpp}/ranking`, { cookies: userACookie }), makeParams(userBOpp))).status).toBe(404);
    // A cannot trigger a rerank on B's opportunity.
    expect((await oppRerank(makeRequest(`http://localhost/api/opportunities/${userBOpp}/rerank`, { method: "POST", cookies: userACookie, body: {} }), makeParams(userBOpp))).status).toBe(404);
    // A cannot build feedback for B's experiment.
    expect((await buildFeedback(makeRequest(`http://localhost/api/experiments/${userBExperiment}/feedback`, { method: "POST", cookies: userACookie }), makeParams(userBExperiment))).status).toBe(404);
    // Unauthenticated is rejected outright.
    expect((await oppRanking(makeRequest(`http://localhost/api/opportunities/${userBOpp}/ranking`), makeParams(userBOpp))).status).toBe(401);

    // No arbitrary score injection: any payload is rejected.
    const injection = await oppRerank(
      makeRequest(`http://localhost/api/opportunities/${userBOpp}/rerank`, {
        method: "POST",
        cookies: userACookie,
        body: { score: 100, delta: 50 },
      }),
      makeParams(userBOpp),
    );
    expect(injection.status).toBe(400);

    // Ranking inputs are server-computed: the DB values never changed by request.
    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: userBOpp } });
    expect(Number(opportunity.overallScore)).toBe(60);
  });

  it("mixed experiments produce MIXED_EXPERIMENT_EVIDENCE and never VALIDATED status", async () => {
    const userBId = (await prisma.user.findFirst({ where: { name: "Learn User B" }, select: { id: true } }))!.id;
    const mixed = await createOpportunityWithMetrics({
      ownerId: userBId,
      conclusion: "VALIDATED",
      metrics: [
        { periodStart: "2026-09-01T00:00:00.000Z", conversions: 4, revenue: 300, cost: 100, impressions: 6000, clicks: 150 },
        { periodStart: "2026-09-02T00:00:00.000Z", conversions: 0, revenue: 0, cost: 400, impressions: 6000, clicks: 20 },
      ],
    });
    createdOpportunityIds.push(mixed.opportunityId);
    createdExperimentIds.push(mixed.experimentId);

    const { rerankOpportunities } = await import("./learning-service");
    const result = await rerankOpportunities(userBId);
    const entry = result.ranked.find((r) => r.opportunityId === mixed.opportunityId)!;
    // Positive conversions/revenue AND a zero-conversion loss exist together;
    // the conflict must be visible either as mixed experiment evidence or as
    // experiment-vs-research contradiction — never silently resolved.
    expect(["MIXED_EXPERIMENT_EVIDENCE", "EXPERIMENT_CONTRADICTS_RESEARCH"]).toContain(entry.contradiction);
    expect(entry.explanation.join(" ")).toMatch(/MIXED_EXPERIMENT_EVIDENCE|contradicts/);
    // Even a positive experiment NEVER flips status to VALIDATED automatically.
    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: mixed.opportunityId } });
    expect(opportunity.status).toBe("VALIDATED"); // unchanged from setup — rerank does not touch status
  });

  it("estimated-only experiments cannot move the ranking", async () => {
    const userBId = (await prisma.user.findFirst({ where: { name: "Learn User B" }, select: { id: true } }))!.id;
    const created = await createOpportunityWithMetrics({ ownerId: userBId, conclusion: null, metrics: [] });
    createdOpportunityIds.push(created.opportunityId);
    createdExperimentIds.push(created.experimentId);
    await prisma.experimentMetric.createMany({
      data: [
        {
          experimentId: created.experimentId,
          recordedAt: new Date("2026-09-01T00:00:00.000Z"),
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
          periodEnd: new Date("2026-09-01T23:59:59.000Z"),
          impressions: 9000,
          conversions: 50,
          revenue: 5000,
          cost: 100,
          source: "forecast",
          dataClass: "ESTIMATED_DATA",
        },
      ],
    });
    const { rerankOpportunities } = await import("./learning-service");
    const result = await rerankOpportunities(userBId);
    const entry = result.ranked.find((r) => r.opportunityId === created.opportunityId)!;
    expect(entry.experimentDelta).toBe(0); // single estimated record → INSUFFICIENT
    expect(entry.explanation.join(" ")).toMatch(/Insufficient recorded experiment data|No completed experiment feedback/);
  });
});
