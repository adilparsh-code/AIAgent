import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the four new read-only console endpoints. Following the existing
 * route-test convention (see auth/sessions route.test.ts): auth and
 * authorization are mocked at the session layer, Prisma is mocked at the
 * repository boundary, and assertions cover the wire payload shape.
 */

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db", () => ({
  getPrisma: () => ({ handoffDelivery: { findMany: mocks.findMany } }),
  isDbUnavailableError: () => false,
}));

const USER = { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" };

describe("GET /api/handoffs/deliveries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/handoffs/deliveries/route");
    const response = await GET(new Request("http://localhost/api/handoffs/deliveries"));
    expect(response.status).toBe(401);
  });

  it("returns only the safe delivery fields for the caller's rows", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.findMany.mockResolvedValueOnce([
      {
        idempotencyKey: "aiagent-handoff:h1:v1",
        handoffId: "h1",
        handoff: {
          id: "h1",
          status: "ACCEPTED",
          contractVersion: 1,
          createdAt: new Date("2026-09-30T10:00:00Z"),
          opportunity: { id: "opp-1", title: "Margin dashboard" },
        },
        status: "DELIVERED",
        attemptCount: 1,
        lastErrorCode: null,
        lastErrorMessage: null,
        httpStatus: 201,
        duplicate: false,
        requestedById: "user-a",
        requestedAt: new Date("2026-09-30T10:00:00Z"),
        deliveredAt: new Date("2026-09-30T10:00:05Z"),
        updatedAt: new Date("2026-09-30T10:00:05Z"),
      },
    ]);

    const { GET } = await import("@/app/api/handoffs/deliveries/route");
    const response = await GET(new Request("http://localhost/api/handoffs/deliveries"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      idempotencyKey: "aiagent-handoff:h1:v1",
      handoffId: "h1",
      status: "DELIVERED",
      duplicate: false,
      attemptCount: 1,
    });
    // Wire-level safety: no credential-shaped fields exist at all.
    const keys = Object.keys(body[0]);
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("authorization");
  });

  it("scopes every query to the calling user's opportunities", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.findMany.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/handoffs/deliveries/route");
    await GET(new Request("http://localhost/api/handoffs/deliveries"));
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { handoff: { opportunity: { ownerId: "user-a" } } },
      }),
    );
  });

  it("bounds the requested limit", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.findMany.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/handoffs/deliveries/route");
    await GET(new Request("http://localhost/api/handoffs/deliveries?limit=9999"));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
