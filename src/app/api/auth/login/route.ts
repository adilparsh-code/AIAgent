import { NextResponse } from "next/server";
import { authenticateUser } from "@/lib/server/auth-service";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/rate-limit";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { UnauthorizedError } from "@/lib/authz-errors";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/login — verify credentials and start a session.
 * Rate-limited per IP+email pair. One generic failure message regardless of
 * whether the email exists (no account enumeration).
 */
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = JSON.parse(raw || "{}") as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";

    const limit = rateLimit("login", `${ip}|${email}`, { max: 10, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const user = await authenticateUser({ email: body.email, password: body.password });
    const { token, expiresAt } = await createSession(user.id);
    const response = NextResponse.json({ user });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return apiError(error, "Login failed");
  }
}
