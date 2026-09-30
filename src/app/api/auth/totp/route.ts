import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/server/session";
import { getTotpStatus } from "@/lib/server/totp-service";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";

/**
 * GET /api/auth/totp — second-factor status for the signed-in user.
 * Safe shape only: booleans and a count. Never the secret, never codes.
 */
export async function GET() {
  try {
    const context = await getSessionContext();
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.json(await getTotpStatus(context.user.id));
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load two-factor status");
  }
}
