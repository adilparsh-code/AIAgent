/**
 * MEDIUM-6 — a discovery candidate whose research/persistence pipeline threw
 * was persisted with status = RESEARCHED.
 *
 * Every reader that filters on RESEARCHED ("this candidate was actually
 * researched and carries a handoff payload") therefore also matched a failure
 * that held only an error string and a NOT_READY handoff, and the run's
 * `researchedCount` counted it as a success.
 *
 * `createOpportunityForCandidate` is the first persistence step inside the
 * per-candidate try block, so forcing it to throw deterministically exercises
 * the exact branch the fix changes, against the real database.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../db";

const hasDb = Boolean(process.env.DATABASE_URL);
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

vi.mock("./discovery-opportunity", () => ({
  createOpportunityForCandidate: async () => {
    throw new Error("opportunity persistence failed (test)");
  },
}));

function stubProvider() {
  return {
    name: "test-provider",
    async search() {
      return [];
    },
  };
}

describe.skipIf(!hasDb)("discovery candidate failure status (real PostgreSQL)", () => {
  const prisma = getPrisma();
  const createdRunIds: string[] = [];

  afterAll(async () => {
    for (const id of createdRunIds) {
      await prisma.discoveryRun.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("records a candidate whose pipeline threw as RESEARCH_FAILED, never RESEARCHED", async () => {
    const { executeDiscoveryRun } = await import("./discovery-service");
    const topic = `medium-6 failure path ${uniqueSuffix()}`;

    const result = await executeDiscoveryRun({
      topic,
      category: "saas",
      maxCandidates: 1,
      providers: [stubProvider() as never],
    });
    createdRunIds.push(result.id);

    const run = await prisma.discoveryRun.findUniqueOrThrow({
      where: { id: result.id },
      include: { candidates: true },
    });

    expect(run.candidates.length).toBeGreaterThan(0);
    for (const candidate of run.candidates) {
      // The whole point of the fix: a candidate that failed is never
      // indistinguishable from one that was genuinely researched.
      expect(candidate.status).toBe("RESEARCH_FAILED");
      expect(candidate.status).not.toBe("RESEARCHED");
      // A failed candidate must not advertise a ready handoff.
      expect(candidate.handoffStatus).toBe("NOT_READY");
      expect(candidate.errors.length).toBeGreaterThan(0);
    }

    // And it must not be counted as researched on the run.
    expect(run.researchedCount).toBe(0);
    expect(result.status).not.toBe("COMPLETED");
  });
});
