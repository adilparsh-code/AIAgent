import { NextResponse } from "next/server";
import { registerUser, AuthValidationError } from "@/lib/server/auth-service";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/rate-limit";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/register — create an account and start a session.
 * Rate-limited to blunt registration abuse. Never returns passwordHash.
 */
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const limit = rateLimit("register", ip, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = JSON.parse(raw || "{}") as { email?: unknown; password?: unknown; name?: unknown };

    const user = await registerUser({ email: body.email, password: body.password, name: body.name });
    const { token, expiresAt } = await createSession(user.id);
    const response = NextResponse.json({ user }, { status: 201 });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    if (error instanceof AuthValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return apiError(error, "Registration failed");
  }
}
