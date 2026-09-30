import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/server/session";
import { confirmTotpEnrollment, TotpServiceError } from "@/lib/server/totp-service";
import { rateLimit, rateLimitIdentity } from "@/lib/server/rate-limit";
import { logger } from "@/lib/server/logger";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/totp/confirm — complete 2FA enrollment (authenticated).
 *
 * Verifies a current authenticator code against the pending secret. Only
 * success enables 2FA and issues recovery codes (shown exactly once, Phase 3/5).
 */
export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    // Phase 7: cap code-guessing against the pending enrollment.
    const limit = rateLimit("totp-confirm", context.user.id, { max: 8, windowMs: 15 * 60 * 1000 });
    const addressLimit = rateLimitIdentity(request, "totp-confirm", context.user.id, {
      max: 20,
      windowMs: 15 * 60 * 1000,
      scopeMax: 300,
    });
    if (!limit.allowed || !addressLimit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.max(limit.retryAfterSeconds, addressLimit.retryAfterSeconds)) } },
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let body: { code?: unknown } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { recoveryCodes } = await confirmTotpEnrollment({ userId: context.user.id, code: body.code });

    logger.operationalEvent({
      event: "totp.enabled",
      safeMessage: "Two-factor authentication enabled after successful code verification.",
      severity: "INFO",
      dataClass: "UNKNOWN",
    });

    return NextResponse.json({ ok: true, recoveryCodes });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    if (error instanceof TotpServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "Failed to confirm 2FA setup");
  }
}
