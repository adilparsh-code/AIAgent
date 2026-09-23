/**
 * Phase 6B — integration tests at the REAL route-handler level with real
 * PostgreSQL: metric persistence, ordering, date filtering, missing-data
 * semantics through the API, aggregation/summary, duplicate protection, and
 * the mandatory Phase 6A authorization checks (User A vs User B).
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

describe.skipIf(!hasDb)("Phase 6B metric time series (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdUserIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  const createdExperimentIds: string[] = [];
  let userACookie: Record<string, string> = {};
  let userBCookie: Record<string, string> = {};
  let userBExperimentId = "";

  afterAll(async () => {
    for (const id of createdExperimentIds) {
      await prisma.experiment.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdOpportunityIds) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("setup: registers two users and creates User B's experiment with a handoff-free opportunity", async () => {
    const { POST: register } = await import("@/app/api/auth/register/route");
    const suffix = uniqueSuffix();
    const resA = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `metric-a-${suffix}@example.com`, password: "password-A-123", name: "Metric User A" },
      }),
    );
    const resB = await register(
      makeRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: { email: `metric-b-${suffix}@example.com`, password: "password-B-123", name: "Metric User B" },
      }),
    );
    userACookie = { ail_session: extractSessionToken(resA) as string };
    userBCookie = { ail_session: extractSessionToken(resB) as string };
    const bodyA = (await resA.json()) as { user: { id: string } };
    const bodyB = (await resB.json()) as { user: { id: string } };
    createdUserIds.push(bodyA.user.id, bodyB.user.id);

    const oppId = `metric-opp-${uniqueSuffix()}`;
    createdOpportunityIds.push(oppId);
    await prisma.opportunity.create({
      data: {
        id: oppId,
        title: `Metric test opportunity ${uniqueSuffix()}`,
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
        overallScore: 62.5,
        confidence: 40,
        status: "VALIDATED",
        risks: ["Platform dependency"],
        isSample: false,
        ownerId: bodyB.user.id,
      },
    });
    const experiment = await prisma.experiment.create({
      data: {
        hypothesis: "Time-series metric test hypothesis",
        opportunityId: oppId,
        target: "Measure conversion",
        budget: 300,
        startDate: new Date(),
        status: "RUNNING",
        isSample: false,
        revenue: 0,
        profit: 0,
        conversionRate: 0,
      },
    });
    createdExperimentIds.push(experiment.id);
    userBExperimentId = experiment.id;
  });

  it("records metrics through the API with missing values staying missing and explicit zeros staying zero", async () => {
    const { POST: createMetric } = await import("@/app/api/experiments/[id]/metrics/route");

    // Day 1: revenue missing entirely, zero clicks recorded explicitly.
    const day1 = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST",
        cookies: userBCookie,
        body: {
          periodStart: "2026-09-01T00:00:00.000Z",
          periodEnd: "2026-09-01T23:59:59.000Z",
          impressions: 1000,
          clicks: 30,
          cost: 50,
          source: "meta-ads",
        },
      }),
      makeParams(userBExperimentId),
    );
    expect(day1.status).toBe(201);
    const day1Json = (await day1.json()) as { revenue: number | null; clicks: number | null; recordedBy: string | null; dataClass: string };
    expect(day1Json.revenue).toBeNull(); // not measured — never zero
    expect(day1Json.clicks).toBe(30); // recorded
    expect(day1Json.dataClass).toBe("REAL_DATA");
    expect(day1Json.recordedBy).toBeTruthy(); // audit: recorded by the session user

    // Day 2: explicit zero conversions, revenue recorded.
    const day2 = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST",
        cookies: userBCookie,
        body: {
          periodStart: "2026-09-02T00:00:00.000Z",
          periodEnd: "2026-09-02T23:59:59.000Z",
          impressions: 800,
          clicks: 10,
          conversions: 0,
          revenue: 120.5,
          cost: 40,
          source: "meta-ads",
        },
      }),
      makeParams(userBExperimentId),
    );
    expect(day2.status).toBe(201);
    const day2Json = (await day2.json()) as { conversions: number | null };
    expect(day2Json.conversions).toBe(0); // explicit zero preserved as zero
  });

  it("rejects invalid metric payloads with clear 4xx responses", async () => {
    const { POST: createMetric } = await import("@/app/api/experiments/[id]/metrics/route");
    const cases: Array<{ body: Record<string, unknown>; expectFragment?: string }> = [
      { body: { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z", clicks: -3 } },
      { body: { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z", visits: 1.5 } },
      { body: { periodStart: "nope", periodEnd: "2026-09-01T01:00:00Z", clicks: 1 } },
      { body: { periodStart: "2026-09-02T00:00:00Z", periodEnd: "2026-09-01T00:00:00Z", clicks: 1 } },
      { body: { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z", dataClass: "real", clicks: 1 } },
      { body: { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z", currency: "dollar", clicks: 1 } },
      { body: { periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-01T01:00:00Z" } },
    ];
    for (const testCase of cases) {
      const res = await createMetric(
        makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
          method: "POST",
          cookies: userBCookie,
          body: testCase.body,
        }),
        makeParams(userBExperimentId),
      );
      expect(res.status).toBe(400);
    }
  });

  it("prevents duplicate ingestion for the same period+source while allowing different sources", async () => {
    const { POST: createMetric } = await import("@/app/api/experiments/[id]/metrics/route");
    const payload = {
      periodStart: "2026-09-03T00:00:00.000Z",
      periodEnd: "2026-09-03T23:59:59.000Z",
      conversions: 2,
      revenue: 90,
      cost: 30,
    };
    const first = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST", cookies: userBCookie, body: { ...payload, source: "ga4" },
      }),
      makeParams(userBExperimentId),
    );
    expect(first.status).toBe(201);
    const duplicate = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST", cookies: userBCookie, body: { ...payload, source: "ga4" },
      }),
      makeParams(userBExperimentId),
    );
    expect(duplicate.status).toBe(409); // same experiment+period+source
    const otherSource = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST", cookies: userBCookie, body: { ...payload, source: "stripe" },
      }),
      makeParams(userBExperimentId),
    );
    expect(otherSource.status).toBe(201); // a different legitimate source is fine
  });

  it("returns the chronological series, honors date filtering, and aggregates correctly", async () => {
    const { GET: listMetrics } = await import("@/app/api/experiments/[id]/metrics/route");
    const { GET: getSummary } = await import("@/app/api/experiments/[id]/metrics/summary/route");

    const all = await listMetrics(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, { cookies: userBCookie }),
      makeParams(userBExperimentId),
    );
    expect(all.status).toBe(200);
    const series = (await all.json()) as Array<{ periodStart: string; revenue: number | null }>;
    expect(series.length).toBe(4);
    expect(new Date(series[0].periodStart) <= new Date(series[1].periodStart)).toBe(true); // ordered

    const filtered = await listMetrics(
      makeRequest(
        `http://localhost/api/experiments/${userBExperimentId}/metrics?from=2026-09-02T00:00:00.000Z&to=2026-09-02T23:59:59.000Z`,
        { cookies: userBCookie },
      ),
      makeParams(userBExperimentId),
    );
    const filteredSeries = (await filtered.json()) as unknown[];
    expect(filteredSeries.length).toBe(1); // only day 2 overlaps the window

    const summaryRes = await getSummary(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics/summary`, { cookies: userBCookie }),
      makeParams(userBExperimentId),
    );
    expect(summaryRes.status).toBe(200);
    const { summary, phase5Metrics } = (await summaryRes.json()) as {
      summary: {
        totals: Record<string, number | null>;
        missing: string[];
        derived: { ctr: number | null; conversionRate: number | null; profit: number | null; roi: number | null };
        dataClass: string;
        cumulative: Array<{ revenue: number | null }>;
      };
      phase5Metrics: Record<string, number>;
    };
    // Raw totals: sums of recorded values only.
    // impressions: day1 1000 + day2 800 (day-3 records recorded none) = 1800
    expect(summary.totals.impressions).toBe(1800);
    // revenue: day2 120.5 + day3-ga4 90 + day3-stripe 90 = 300.5
    expect(summary.totals.revenue).toBeCloseTo(300.5);
    expect(summary.totals.cost).toBeCloseTo(50 + 40 + 30 + 30); // 150
    // conversions: day2 explicit 0 + day3-ga4 2 + day3-stripe 2 = 4 — two
    // legitimate sources measuring the same period are both preserved.
    expect(summary.totals.conversions).toBe(4);
    expect(summary.totals.visits).toBeNull(); // never recorded anywhere
    expect(summary.missing).toContain("visits");
    expect(summary.missing).toContain("leads");
    // Derived metrics respect missing/zero denominators.
    expect(summary.derived.ctr).toBeCloseTo(40 / 1800);
    expect(summary.derived.conversionRate).toBeNull(); // visits missing → no invented denominator
    expect(summary.derived.profit).toBeCloseTo(300.5 - 150); // 150.5
    expect(summary.derived.roi).toBeCloseTo(150.5 / 150);
    // Cumulative carries recorded values forward; visits stays null.
    expect(summary.cumulative[0].revenue).toBeNull();
    // Phase 5 bridge: only recorded keys are present.
    expect(phase5Metrics.revenue).toBeCloseTo(300.5);
    expect("visits" in phase5Metrics).toBe(false);
  });

  it("evaluates from the time series with unchanged Phase 5 decision rules", async () => {
    const { GET: evaluatePreview } = await import("@/app/api/experiments/[id]/evaluate/route");
    const preview = await evaluatePreview(makeRequest(`http://localhost/api/experiments/${userBExperimentId}/evaluate`, { cookies: userBCookie }), makeParams(userBExperimentId));
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      metricsSource: string;
      evaluation: { derived: { profit: number | null } };
      decision: { decision: string; basis: string };
    };
    expect(body.metricsSource).toBe("TIME_SERIES");
    expect(body.evaluation.derived.profit).toBeCloseTo(150.5);
    // Explicit Phase 5 rules: conversions 4 + profit 150.5 + ROI ~1.0 ≥ 0.2 → WIN.
    expect(body.decision.decision).toBe("WIN");
  });

  it("denies User A every metric operation on User B's experiment; mutation by B still works", async () => {
    const { POST: createMetric, GET: listMetrics } = await import("@/app/api/experiments/[id]/metrics/route");
    const { GET: getSummary } = await import("@/app/api/experiments/[id]/metrics/summary/route");
    const { GET: evaluatePreview } = await import("@/app/api/experiments/[id]/evaluate/route");

    // A cannot add metrics to B's experiment.
    const createA = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST",
        cookies: userACookie,
        body: { periodStart: "2026-09-05T00:00:00.000Z", periodEnd: "2026-09-05T23:59:59.000Z", conversions: 99 },
      }),
      makeParams(userBExperimentId),
    );
    expect(createA.status).toBe(404);

    // A cannot read B's series or summary.
    const listA = await listMetrics(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, { cookies: userACookie }),
      makeParams(userBExperimentId),
    );
    expect(listA.status).toBe(404);
    const summaryA = await getSummary(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics/summary`, { cookies: userACookie }),
      makeParams(userBExperimentId),
    );
    expect(summaryA.status).toBe(404);

    // A cannot evaluate B's experiment.
    const evaluateA = await evaluatePreview(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/evaluate`, { cookies: userACookie }),
      makeParams(userBExperimentId),
    );
    expect(evaluateA.status).toBe(404);

    // Nothing was created by A's attempts.
    const count = await prisma.experimentMetric.count({ where: { experimentId: userBExperimentId } });
    expect(count).toBe(4);

    // Unauthenticated access is rejected outright.
    const anon = await listMetrics(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`),
      makeParams(userBExperimentId),
    );
    expect(anon.status).toBe(401);

    // B can still mutate: append-only correction row (delete policy below).
    const appendB = await createMetric(
      makeRequest(`http://localhost/api/experiments/${userBExperimentId}/metrics`, {
        method: "POST",
        cookies: userBCookie,
        body: {
          periodStart: "2026-09-04T00:00:00.000Z",
          periodEnd: "2026-09-04T23:59:59.000Z",
          conversions: 1,
          revenue: 25,
          source: "correction",
          dataClass: "ESTIMATED_DATA",
          notes: "correction for mis-reported day 4",
        },
      }),
      makeParams(userBExperimentId),
    );
    expect(appendB.status).toBe(201);
    const appended = (await appendB.json()) as { dataClass: string };
    expect(appended.dataClass).toBe("ESTIMATED_DATA"); // class is user-declared, never converted
  });

  it("supports owner-scoped delete of a correction record and cascade-deletes with the experiment", async () => {
    const rows = await prisma.experimentMetric.findMany({ where: { experimentId: userBExperimentId, source: "correction" } });
    expect(rows).toHaveLength(1);
    const correctionId = rows[0].id;

    // There is no dedicated delete route: deletion is exercised at repository
    // level with identical owner scoping.
    const { metricRepository } = await import("./repositories/metrics");
    const userBId = (await prisma.user.findFirst({ where: { name: "Metric User B" }, select: { id: true } }))!.id;
    const userAId = (await prisma.user.findFirst({ where: { name: "Metric User A" }, select: { id: true } }))!.id;

    // A cannot delete B's metric record.
    const deletedByA = await metricRepository.deleteByIdForOwner(correctionId, userAId);
    expect(deletedByA).toBeNull();
    // B can delete their own correction record.
    const deletedByB = await metricRepository.deleteByIdForOwner(correctionId, userBId);
    expect(deletedByB?.id).toBe(correctionId);

    // Cascade: deleting the experiment removes its metric rows (FK ON DELETE CASCADE).
    const countBefore = await prisma.experimentMetric.count({ where: { experimentId: userBExperimentId } });
    expect(countBefore).toBe(4);
    await prisma.experiment.delete({ where: { id: userBExperimentId } });
    createdExperimentIds.length = 0; // already deleted
    const countAfter = await prisma.experimentMetric.count({ where: { experimentId: userBExperimentId } });
    expect(countAfter).toBe(0);
  });
});
