import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/server/session";
import { regenerateRecoveryCodes, TotpServiceError } from "@/lib/server/totp-service";
import { rateLimit, rateLimitIdentity } from "@/lib/server/rate-limit";
import { logger } from "@/lib/server/logger";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

const MAX_BODY_BYTES = 4_096;

/**
 * POST /api/auth/totp/recovery — regenerate recovery codes (authenticated).
 * Requires password AND a current TOTP code (Phase 5/6). All previous
 * recovery codes — used or unused — are invalidated. Plaintext codes are
 * returned exactly once and never stored or logged.
 */
export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    // Phase 7: cap brute-force attempts against the password/TOTP re-check.
    const limit = rateLimit("totp-recovery", context.user.id, { max: 5, windowMs: 15 * 60 * 1000 });
    const addressLimit = rateLimitIdentity(request, "totp-recovery", context.user.id, {
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
    let body: { password?: unknown; code?: unknown } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { recoveryCodes } = await regenerateRecoveryCodes({
      userId: context.user.id,
      password: body.password,
      code: body.code,
    });

    logger.operationalEvent({
      event: "totp.recovery_regenerated",
      safeMessage: "Recovery codes regenerated; all previous recovery codes were invalidated.",
      severity: "WARNING",
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
    return apiError(error, "Failed to regenerate recovery codes");
  }
}
