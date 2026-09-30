import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/server/session";
import { startTotpEnrollment, TotpServiceError } from "@/lib/server/totp-service";
import { rateLimitIdentity } from "@/lib/server/rate-limit";
import { logger } from "@/lib/server/logger";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/totp/setup — start 2FA enrollment (authenticated).
 *
 * Requires the current password (fresh verification, Phase 3). Generates a
 * pending TOTP secret and returns the otpauth:// URI for the authenticator
 * app. 2FA is NOT enabled by this call; see /api/auth/totp/confirm.
 */
export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    // Phase 7: limit setup attempts per user (brute-forcing the password
    // re-check here is capped; the address bucket bounds the flood).
    const limit = rateLimitIdentity(request, "totp-setup", context.user.id, {
      max: 5,
      windowMs: 15 * 60 * 1000,
      scopeMax: 100,
    });
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
    let body: { password?: unknown } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { otpauthUri, accountLabel } = await startTotpEnrollment({
      userId: context.user.id,
      email: context.user.email,
      password: body.password,
    });

    logger.operationalEvent({
      event: "totp.setup_started",
      safeMessage: "2FA enrollment started: a pending secret was generated after password re-verification.",
      severity: "INFO",
      dataClass: "UNKNOWN",
    });

    return NextResponse.json({ otpauthUri, accountLabel });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    if (error instanceof TotpServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "Failed to start 2FA setup");
  }
}
