import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  deliveryFindMany: vi.fn(),
  researchFindMany: vi.fn(),
  handoffFindMany: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    handoffDelivery: { findMany: mocks.deliveryFindMany },
    researchRun: { findMany: mocks.researchFindMany },
    handoff: { findMany: mocks.handoffFindMany },
  }),
  isDbUnavailableError: () => false,
}));

const USER = { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" };

describe("GET /api/system/audit-events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/system/audit-events/route");
    const response = await GET(new Request("http://localhost/api/system/audit-events"));
    expect(response.status).toBe(401);
  });

  it("merges persisted delivery, research and handoff rows newest-first", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.deliveryFindMany.mockResolvedValueOnce([
      {
        id: "d1",
        idempotencyKey: "aiagent-handoff:h1:v1",
        handoffId: "h1",
        handoff: { opportunityId: "opp-1", opportunity: { title: "Margin dashboard" } },
        status: "REJECTED",
        lastErrorCode: "ADAPTATION_REFUSED",
        lastErrorMessage: "Handoff could not be adapted (MISSING_BUSINESS_MODEL at businessModel); nothing was sent.",
        duplicate: false,
        updatedAt: new Date("2026-09-30T12:00:00Z"),
      },
    ]);
    mocks.researchFindMany.mockResolvedValueOnce([
      {
        id: "r1",
        opportunityId: "opp-1",
        status: "FAILED",
        startedAt: new Date("2026-09-30T10:00:00Z"),
        completedAt: new Date("2026-09-30T10:01:00Z"),
        errors: ["All providers failed health gate"],
        opportunity: { title: "Margin dashboard" },
      },
    ]);
    mocks.handoffFindMany.mockResolvedValueOnce([
      {
        id: "h1",
        opportunityId: "opp-1",
        status: "REJECTED",
        createdAt: new Date("2026-09-29T10:00:00Z"),
        updatedAt: new Date("2026-09-30T11:00:00Z"),
        acceptedAt: null,
        rejectedAt: new Date("2026-09-30T11:00:00Z"),
        rejectionReason: "Out of scope for this quarter",
        opportunity: { title: "Margin dashboard" },
      },
    ]);

    const { GET } = await import("@/app/api/system/audit-events/route");
    const response = await GET(new Request("http://localhost/api/system/audit-events"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { coverage: string; events: Array<Record<string, unknown>> };

    expect(body.coverage).toContain("Persisted");
    expect(body.events).toHaveLength(3);
    expect(body.events.map((event) => event.action)).toEqual([
      "handoff.delivery",
      "handoff.rejected",
      "research.run",
    ]);
    expect(body.events[2]).toMatchObject({ status: "FAILED", detail: "All providers failed health gate" });

    // Owner scoping on every source query.
    expect(mocks.deliveryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { handoff: { opportunity: { ownerId: "user-a" } } } }),
    );
    expect(mocks.researchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunity: { ownerId: "user-a" } } }),
    );
  });

  it("skips non-terminal research runs (no auditable outcome yet)", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.deliveryFindMany.mockResolvedValueOnce([]);
    mocks.researchFindMany.mockResolvedValueOnce([
      {
        id: "r-running",
        opportunityId: "opp-1",
        status: "RUNNING",
        startedAt: new Date("2026-09-30T10:00:00Z"),
        completedAt: null,
        errors: [],
        opportunity: { title: "Margin dashboard" },
      },
    ]);
    mocks.handoffFindMany.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/system/audit-events/route");
    const response = await GET(new Request("http://localhost/api/system/audit-events"));
    const body = (await response.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(0);
  });
});
