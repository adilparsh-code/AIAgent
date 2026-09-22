import { NextResponse } from "next/server";
import { isDbUnavailableError } from "./db";
import { logger } from "./server/logger";

/**
 * Maps a thrown error to a client-safe response.
 *
 * Raw `error.message` is never echoed on 500 responses: Prisma and Node internals
 * can embed server file paths, query text, and stack details (CWE-209). Full
 * details are logged server-side instead. Only deliberately thrown, known-safe
 * messages (see ensureOpportunityExists) are passed through, on a 404.
 */
export function apiError(error: unknown, fallback = "Request failed") {
  if (isDbUnavailableError(error)) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  if (error instanceof Error) {
    if (error.message.includes("Foreign key constraint") || error.message.includes("Record to update not found")) {
      return NextResponse.json({ error: "Related record not found" }, { status: 404 });
    }
    // Deliberately thrown client-facing "not found" (exact shape, not a Prisma message).
    if (/^Opportunity .+ was not found$/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
  }

  // Unexpected error: log full details server-side, return a generic message.
  logger.databaseError("api.unhandled", error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: fallback }, { status: 500 });
}
