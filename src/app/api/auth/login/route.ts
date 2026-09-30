import { NextResponse } from "next/server";
import { authenticateUser } from "@/lib/server/auth-service";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { rateLimitIdentity } from "@/lib/server/rate-limit";
import { createPreAuthToken } from "@/lib/server/preauth";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { logger } from "@/lib/server/logger";
import { UnauthorizedError } from "@/lib/authz-errors";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/login — verify credentials and start a session.
 * Rate-limited per IP+email pair. One generic failure message regardless of
 * whether the email exists (no account enumeration).
 *
 * TOTP-2FA hardening: when the account has two-factor enabled, a valid
 * password does NOT create a session. The response instead carries a
 * short-lived, server-side pre-auth token scoped only to the pending login;
 * the session is issued only after the second factor verifies (see
 * /api/auth/totp/login). The pre-auth token is never a cookie, so it cannot
 * satisfy middleware or any protected API.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = JSON.parse(raw || "{}") as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";

    // MEDIUM-1: keyed on the address AND on a client-independent scope
    // bucket, so forging x-forwarded-for no longer grants unlimited attempts.
    const limit = rateLimitIdentity(request, "login", email, {
      max: 10,
      windowMs: 15 * 60 * 1000,
      scopeMax: 300,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const user = await authenticateUser({ email: body.email, password: body.password });

    const totpRecord = await getPrisma().totpSecret.findUnique({
      where: { userId: user.id },
      select: { totpEnabled: true },
    });
    if (totpRecord?.totpEnabled) {
      const preAuth = createPreAuthToken(user);
      return NextResponse.json({
        totpRequired: true,
        preAuthToken: preAuth.token,
        preAuthExpiresAt: preAuth.expiresAt.toISOString(),
      });
    }

    // Phase 10 — admin policy (safe, non-locking): the architecture has no
    // per-role security-policy enforcement, so a hard "ADMIN requires 2FA"
    // gate could silently lock out existing administrators. Instead the
    // password-only admin sign-in is flagged server-side; hard enforcement is
    // documented as a future change (README, TOTP section).
    if (user.role === "ADMIN") {
      logger.operationalEvent({
        event: "totp.admin_without_2fa",
        safeMessage: "An ADMIN account signed in with password only (two-factor authentication not enrolled).",
        severity: "WARNING",
        dataClass: "UNKNOWN",
      });
    }

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
