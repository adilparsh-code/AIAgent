import { NextResponse } from "next/server";
import { peekPreAuthToken, consumePreAuthToken } from "@/lib/server/preauth";
import { verifySecondFactorForLogin } from "@/lib/server/totp-service";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { rateLimit, rateLimitIdentity } from "@/lib/server/rate-limit";
import { logger } from "@/lib/server/logger";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

const MAX_BODY_BYTES = 4_096;

/** Identical refusal for wrong code / bad token / unknown user — no enumeration. */
function secondFactorFailed() {
  return NextResponse.json(
    { error: "That code is not correct. Check your authenticator app and try again." },
    { status: 403 },
  );
}

/**
 * POST /api/auth/totp/login — exchange a pre-auth token + second factor for a
 * full session (TOTP-2FA hardening, Phase 4).
 *
 * - The pre-auth token never grants API access by itself: it is not a cookie,
 *   lives only server-side for 5 minutes, and is consumed on success.
 * - Both buckets below key on nothing attacker-new: the per-attempt bucket is
 *   the pre-auth token hash, the address bucket reuses the login limiter's
 *   identity scheme (per-IP + spoof-proof scope bucket).
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let body: { preAuthToken?: unknown; code?: unknown } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const preAuth = peekPreAuthToken(body.preAuthToken);
    if (!preAuth) return secondFactorFailed();

    // Rate limiting (Phase 7): 8 second-factor attempts per pending login per
    // 15 minutes, plus the shared address/scope buckets. On refusal the
    // pending login is revoked so a stolen token buys nothing.
    const limit = rateLimit("totp-login-attempt", preAuth.userId, { max: 8, windowMs: 15 * 60 * 1000 });
    const addressLimit = rateLimitIdentity(request, "totp-login", preAuth.userId, {
      max: 20,
      windowMs: 15 * 60 * 1000,
      scopeMax: 300,
    });
    if (!limit.allowed || !addressLimit.allowed) {
      consumePreAuthToken(body.preAuthToken);
      logger.operationalEvent({
        event: "totp.login_rate_limited",
        safeMessage: "Second-factor attempt refused: rate limit exceeded for a pending login.",
        severity: "WARNING",
        dataClass: "UNKNOWN",
      });
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.max(limit.retryAfterSeconds, addressLimit.retryAfterSeconds)) } },
      );
    }

    const verified = await verifySecondFactorForLogin({
      preAuthUserId: preAuth.userId,
      code: body.code,
    });
    if (!verified) {
      logger.operationalEvent({
        event: "totp.verification_failed",
        safeMessage: "Second factor rejected for a pending login.",
        severity: "WARNING",
        dataClass: "UNKNOWN",
      });
      return secondFactorFailed();
    }

    consumePreAuthToken(body.preAuthToken);
    const { token, expiresAt } = await createSession(preAuth.userId);
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, token, expiresAt);
    logger.operationalEvent({
      event: "totp.verification_success",
      safeMessage: "Second factor accepted; full session issued.",
      severity: "INFO",
      dataClass: "UNKNOWN",
    });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Two-factor verification failed");
  }
}
