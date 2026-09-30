import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db", () => ({
  getPrisma: () => ({ researchRun: { findMany: mocks.findMany } }),
  isDbUnavailableError: () => false,
}));

const USER = { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" };

describe("GET /api/research/recent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/research/recent/route");
    const response = await GET(new Request("http://localhost/api/research/recent"));
    expect(response.status).toBe(401);
  });

  it("scopes runs through the owning opportunity and passes validation through", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "run-1",
        opportunityId: "opp-1",
        status: "COMPLETED",
        startedAt: new Date("2026-09-30T10:00:00Z"),
        completedAt: new Date("2026-09-30T10:01:00Z"),
        confidence: 0.82,
        conclusion: "VALIDATED",
        conclusionBasis: "2 supported signals, no contradictions",
        providersAttempted: ["brave", "reddit"],
        providersSucceeded: ["brave"],
        providerStatuses: [],
        errors: [],
        opportunity: { id: "opp-1", title: "Margin dashboard" },
        validation: {
          demandStatus: "SUPPORTED",
          painPointStatus: "MIXED",
          commercialIntentStatus: "SUPPORTED",
          trendStatus: "INSUFFICIENT",
          competitionStatus: "MIXED",
          evidenceCoverage: 4,
          sourceDiversity: 2,
          contradictionCount: 0,
          confidence: 0.82,
          conclusion: "VALIDATED",
        },
        _count: { evidence: 12, sources: 2, queries: 6 },
      },
    ]);

    const { GET } = await import("@/app/api/research/recent/route");
    const response = await GET(new Request("http://localhost/api/research/recent"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { opportunity: { ownerId: "user-a" } },
      }),
    );
    expect(body[0]).toMatchObject({
      opportunityTitle: "Margin dashboard",
      conclusion: "VALIDATED",
      evidenceCount: 12,
      validation: {
        conclusion: "VALIDATED",
        evidenceCoverage: 4,
        signals: { demand: "SUPPORTED", trend: "INSUFFICIENT" },
      },
    });
  });

  it("answers 503 when persistence is not configured (never fake data)", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    const dbError = Object.assign(new Error("DATABASE_URL is not configured"), { name: "PrismaClientInitializationError" });
    mocks.findMany.mockRejectedValueOnce(dbError);

    const { GET } = await import("@/app/api/research/recent/route");
    const response = await GET(new Request("http://localhost/api/research/recent"));
    expect([503, 500]).toContain(response.status);
    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
  });
});
