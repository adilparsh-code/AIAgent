import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db", () => ({
  getPrisma: () => ({ agentRun: { findMany: mocks.findMany } }),
  isDbUnavailableError: () => false,
}));

const USER = { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" };

describe("GET /api/agent-runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/agent-runs/route");
    const response = await GET(new Request("http://localhost/api/agent-runs"));
    expect(response.status).toBe(401);
  });

  it("scopes runs to the calling user and omits run payloads", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(USER);
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "run-1",
        agentId: "agent-1",
        agent: { id: "agent-1", name: "Discovery Agent", type: "DISCOVERY" },
        task: "Discover opportunities",
        status: "COMPLETED",
        startedAt: new Date("2026-09-30T10:00:00Z"),
        completedAt: new Date("2026-09-30T10:00:03Z"),
        errors: [],
      },
    ]);

    const { GET } = await import("@/app/api/agent-runs/route");
    const response = await GET(new Request("http://localhost/api/agent-runs"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: "user-a" } }),
    );
    expect(body[0]).toMatchObject({ id: "run-1", agentName: "Discovery Agent", status: "COMPLETED" });
    // input/output payloads are deliberately not part of this surface.
    expect(Object.keys(body[0])).not.toContain("input");
    expect(Object.keys(body[0])).not.toContain("output");
  });
});
