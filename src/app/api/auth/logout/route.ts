import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { destroySessionByToken, clearSessionCookie, readSessionToken } from "@/lib/server/session";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

/**
 * POST /api/auth/logout — invalidate the server-side session and clear the
 * cookie. Idempotent: logging out without a session still succeeds.
 */
export async function POST() {
  try {
    const token = await readSessionToken();
    if (token) await destroySessionByToken(token);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Logout failed");
  }
}

/** GET /api/auth/logout is not supported — keep the method list tight. */
export async function GET() {
  const user = await requireUser().catch(() => null);
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
