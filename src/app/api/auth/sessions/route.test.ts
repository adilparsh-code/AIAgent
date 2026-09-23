import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  listUserSessions: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  revokeUserSession: vi.fn(),
}));

vi.mock("@/lib/server/session", () => mocks);
vi.mock("@/lib/db", () => ({ isDbUnavailableError: () => false }));

describe("auth sessions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    mocks.getSessionContext.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/auth/sessions/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns only safe session metadata for the current user", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      sessionId: "current",
      user: { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" },
    });
    mocks.listUserSessions.mockResolvedValueOnce([
      {
        id: "current",
        createdAt: "2026-09-23T10:00:00.000Z",
        lastUsedAt: "2026-09-23T10:05:00.000Z",
        expiresAt: "2026-09-30T10:00:00.000Z",
        isCurrent: true,
      },
    ]);

    const { GET } = await import("@/app/api/auth/sessions/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessions: [
        {
          id: "current",
          createdAt: "2026-09-23T10:00:00.000Z",
          lastUsedAt: "2026-09-23T10:05:00.000Z",
          expiresAt: "2026-09-30T10:00:00.000Z",
          isCurrent: true,
        },
      ],
    });
  });

  it("revokes one other session for the authenticated user", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      sessionId: "current",
      user: { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" },
    });
    mocks.revokeUserSession.mockResolvedValueOnce(true);

    const { DELETE } = await import("@/app/api/auth/sessions/route");
    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ sessionId: "other" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.revokeUserSession).toHaveBeenCalledWith("user-a", "other");
  });

  it("rejects attempts to revoke the current session through session management", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      sessionId: "current",
      user: { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" },
    });

    const { DELETE } = await import("@/app/api/auth/sessions/route");
    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ sessionId: "current" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.revokeUserSession).not.toHaveBeenCalled();
  });

  it("revokes all other sessions without revoking the current session", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      sessionId: "current",
      user: { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" },
    });
    mocks.revokeAllUserSessions.mockResolvedValueOnce(3);

    const { DELETE } = await import("@/app/api/auth/sessions/route");
    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ all: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: 3 });
    expect(mocks.revokeAllUserSessions).toHaveBeenCalledWith("user-a", "current");
  });

  it("does not allow one user to revoke another user's session", async () => {
    mocks.getSessionContext.mockResolvedValueOnce({
      sessionId: "current-a",
      user: { id: "user-a", email: "a@example.com", name: "A", role: "USER", status: "ACTIVE" },
    });
    mocks.revokeUserSession.mockResolvedValueOnce(false);

    const { DELETE } = await import("@/app/api/auth/sessions/route");
    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ sessionId: "user-b-session" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.revokeUserSession).toHaveBeenCalledWith("user-a", "user-b-session");
  });
});
