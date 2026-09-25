/**
 * HIGH-3 regression suite: a live research cycle must be atomically idempotent.
 *
 * The bug this locks down: the deterministic run id was *checked* before the
 * external provider/health calls but never *reserved*, so two concurrent
 * requests with the same requestId both saw "no run yet" and both called the
 * providers.
 *
 * Every external dependency is mocked here (no network, no real provider, no
 * fabricated live data): the only assertion that matters is that the provider
 * pipeline runs exactly once per requestId.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";
import type { ResearchRun } from "../research-types";

const hasDb = Boolean(process.env.DATABASE_URL);

/** Counts every invocation of the external research/health pipeline (per test). */
const providerCalls = { runResearch: 0, activate: 0 };
/** Monotonic id source, never reset: persisted Evidence ids are globally unique. */
let runSequence = 0;

vi.mock("@/lib/research-orchestrator", () => ({
  runResearch: vi.fn(async (opportunityId: string, title: string) => {
    providerCalls.runResearch += 1;
    return buildResearchRun(opportunityId, title, `run-${(runSequence += 1)}`);
  }),
}));

vi.mock("@/lib/integrations/activation-service", () => ({
  getProviderActivations: vi.fn(async () => [
    {
      provider: "brave-search",
      configured: true,
      status: "CONFIGURED",
      safeReason: "test activation",
      checklistComplete: true,
      missingEnvVars: [],
      capabilities: ["SEARCH_WEB"],
    },
  ]),
}));

vi.mock("@/lib/server/live-activation-service", () => ({
  activateProvider: vi.fn(async () => {
    providerCalls.activate += 1;
    return { state: "HEALTHY", events: [] };
  }),
}));

vi.mock("@/lib/server/opportunity-decision-service", () => ({
  getOpportunityDecision: vi.fn(async () => null),
}));

function buildResearchRun(opportunityId: string, title: string, id: string): ResearchRun {
  return {
    id,
    opportunityId,
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    queries: [{ query: `${title} demand`, source: "brave", purpose: "demand" }],
    evidence: [
      {
        id: `ev-${id}`,
        source: "brave",
        title: "Demand",
        url: "https://example.com/demand",
        snippet: "Existing demand",
        collectedAt: new Date().toISOString(),
        relevanceScore: 0.8,
        qualityScore: 0.8,
        hash: `hash-${id}`,
        supports: ["demand"],
        contradicts: [],
        // Not REAL_LIVE_DATA: the provider is stubbed, so provenance stays honest.
        dataClass: "SAMPLE_DATA",
      },
    ],
    findings: [],
    validationSignals: [
      {
        key: "demand",
        label: "Demand",
        status: "MIXED",
        evidenceIds: [`ev-${id}`],
        basis: "1 evidence item(s) from 1 provider",
      },
    ],
    confidence: 0.5,
    conclusion: "PROMISING",
    conclusionBasis: "1 signal(s) partially supported",
    providersAttempted: ["brave"],
    providersSucceeded: ["brave"],
    providerStatuses: [{ name: "brave", status: "SUCCEEDED", evidenceCount: 1, error: null }],
    scoreIntegration: { suggestedOverallScore: null, factors: [] },
    errors: [],
  } as unknown as ResearchRun;
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function makeUserAndOpportunity(tag: string) {
  const prisma = getPrisma();
  const user = await prisma.user.create({
    data: {
      email: `livecycle-${tag}-${suffix}@example.com`.toLowerCase(),
      name: `Live cycle ${tag}`,
      passwordHash: "not-a-real-hash",
      role: "USER",
      status: "ACTIVE",
    },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      title: `Live cycle opp ${tag} ${suffix}`,
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
      ownerId: user.id,
    },
  });
  return { user, opportunity };
}

describe.skipIf(!hasDb)("HIGH-3 live research reservation (real PostgreSQL, stubbed providers)", () => {
  const prisma = getPrisma();
  const createdUsers: string[] = [];
  const createdOpportunities: string[] = [];

  beforeEach(() => {
    providerCalls.runResearch = 0;
    providerCalls.activate = 0;
  });

  afterAll(async () => {
    for (const id of createdOpportunities) {
      await prisma.opportunity.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("concurrent identical requestIds trigger exactly one provider execution", async () => {
    const { user, opportunity } = await makeUserAndOpportunity("concurrent");
    createdUsers.push(user.id);
    createdOpportunities.push(opportunity.id);

    const { runLiveResearchCycle } = await import("@/lib/server/live-research-cycle-service");
    const input = {
      ownerId: user.id,
      opportunityId: opportunity.id,
      title: "Teacher worksheet demand",
      requestId: `concurrent_${suffix}`,
    };

    // Both requests are issued without awaiting in between, so they race.
    const [first, second] = await Promise.all([
      runLiveResearchCycle(input),
      runLiveResearchCycle(input),
    ]);

    // Exactly one round of external work happened.
    expect(providerCalls.runResearch).toBe(1);
    expect(providerCalls.activate).toBe(1);

    // Exactly one caller executed; the other replayed instead of duplicating.
    const replays = [first, second].filter((result) => result.idempotentReplay);
    const executions = [first, second].filter((result) => !result.idempotentReplay);
    expect(executions).toHaveLength(1);
    expect(replays).toHaveLength(1);
    expect(replays[0]!.safeMessage).toMatch(/no duplicate/i);

    // And exactly one persisted run exists for the deterministic id.
    const runs = await prisma.researchRun.findMany({ where: { opportunityId: opportunity.id } });
    expect(runs).toHaveLength(1);
  });

  it("reserves before the external call: a second request never re-runs a completed cycle", async () => {
    const { user, opportunity } = await makeUserAndOpportunity("replay");
    createdUsers.push(user.id);
    createdOpportunities.push(opportunity.id);

    const { runLiveResearchCycle } = await import("@/lib/server/live-research-cycle-service");
    const input = {
      ownerId: user.id,
      opportunityId: opportunity.id,
      title: "Teacher worksheet demand",
      requestId: `replay_${suffix}`,
    };

    const first = await runLiveResearchCycle(input);
    expect(first.status).toBe("SUCCEEDED");
    expect(first.idempotentReplay).toBe(false);
    expect(providerCalls.runResearch).toBe(1);

    const second = await runLiveResearchCycle(input);
    expect(second.status).toBe("SUCCEEDED");
    expect(second.idempotentReplay).toBe(true);
    // No second provider execution.
    expect(providerCalls.runResearch).toBe(1);
  });

  it("does not inflate the opportunity research-run count across a reservation replay", async () => {
    const { user, opportunity } = await makeUserAndOpportunity("count");
    createdUsers.push(user.id);
    createdOpportunities.push(opportunity.id);

    const { runLiveResearchCycle } = await import("@/lib/server/live-research-cycle-service");
    const input = {
      ownerId: user.id,
      opportunityId: opportunity.id,
      title: "Teacher worksheet demand",
      requestId: `count_${suffix}`,
    };

    await runLiveResearchCycle(input);
    await runLiveResearchCycle(input); // idempotent replay

    const runs = await prisma.researchRun.findMany({ where: { opportunityId: opportunity.id } });
    expect(runs).toHaveLength(1);
    // The reserved run is still counted exactly once against the opportunity.
    const opportunityRow = await prisma.opportunity.findUniqueOrThrow({
      where: { id: opportunity.id },
      select: { researchRunCount: true, lastResearchRunId: true },
    });
    expect(opportunityRow.researchRunCount).toBe(1);
    expect(opportunityRow.lastResearchRunId).toBe(runs[0]!.id);
  });

  it("releases the reservation when the cycle fails, so the same requestId can be retried", async () => {
    const { user, opportunity } = await makeUserAndOpportunity("release");
    createdUsers.push(user.id);
    createdOpportunities.push(opportunity.id);

    const { runLiveResearchCycle } = await import("@/lib/server/live-research-cycle-service");
    const { runResearch } = await import("@/lib/research-orchestrator");
    const requestId = `release_${suffix}`;
    const input = { ownerId: user.id, opportunityId: opportunity.id, title: "Teacher worksheet demand", requestId };

    (runResearch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      providerCalls.runResearch += 1;
      throw new Error("provider exploded");
    });

    await expect(runLiveResearchCycle(input)).rejects.toThrow("provider exploded");

    // No dangling placeholder blocks the retry.
    const afterFailure = await prisma.researchRun.findMany({ where: { opportunityId: opportunity.id } });
    expect(afterFailure).toHaveLength(0);

    // The retry is allowed to run and now succeeds.
    const retried = await runLiveResearchCycle(input);
    expect(retried.status).toBe("SUCCEEDED");
    expect(retried.idempotentReplay).toBe(false);
  });
});
