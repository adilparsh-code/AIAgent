import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

/**
 * GET /api/auth/me — current authenticated identity (from the session cookie,
 * never from client input). Safe shape only: no passwordHash, no session token.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    const status = error instanceof Error && error.name === "UnauthorizedError" ? 401 : undefined;
    if (status) return NextResponse.json({ error: "Authentication required" }, { status });
    return apiError(error, "Failed to resolve session");
  }
}
