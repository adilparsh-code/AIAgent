import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionContext,
  listUserSessions,
  readSessionToken,
  revokeAllUserSessions,
  revokeUserSession,
} from "@/lib/server/session";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

/**
 * GET /api/auth/sessions
 * Returns safe metadata for the caller's active sessions only.
 */
export async function GET() {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const sessions = await listUserSessions(context.user.id, context.sessionId);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to list sessions");
  }
}

/**
 * DELETE /api/auth/sessions
 * Body:
 *   { "sessionId": "..." } — revoke one of the caller's other sessions.
 *   { "all": true }        — revoke all other sessions, keeping this one alive.
 *
 * The current session cannot be revoked through this endpoint; use /logout for
 * that operation. Ownership is checked in the database by userId + sessionId.
 */
export async function DELETE(request: Request) {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: "Request body too large" }, { status: 413 });

    let body: { sessionId?: unknown; all?: unknown } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.all === true) {
      const revoked = await revokeAllUserSessions(context.user.id, context.sessionId);
      return NextResponse.json({ ok: true, revoked });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId || sessionId.length > 64) {
      return NextResponse.json({ error: "A valid sessionId is required" }, { status: 400 });
    }

    if (sessionId === context.sessionId) {
      return NextResponse.json(
        { error: "The current session cannot be revoked here; use logout" },
        { status: 400 },
      );
    }

    const revoked = await revokeUserSession(context.user.id, sessionId);
    if (!revoked) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to revoke session");
  }
}
