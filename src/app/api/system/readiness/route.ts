import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

/**
 * GET /api/system/readiness — Phase 25 unauthenticated deployment readiness.
 *
 * Deliberately minimal and safe to expose publicly:
 * - verifies DATABASE connectivity with a trivial query (deployment monitors
 *   need a real connectivity signal, not just HTTP 200);
 * - reports migration presence from a metadata query when possible;
 * - returns NO user data, NO counts, NO provider names/statuses, and NO
 *   secrets — those live behind the authenticated /api/system/* surfaces.
 * - never throws: startup failure behavior is an honest 503 JSON body.
 */
// Deployment monitors need the LIVE database state, never a build-time snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    let migrationsApplied: boolean | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM "_prisma_migrations" LIMIT 1`;
      migrationsApplied = rows.length > 0;
    } catch {
      // The migrations table may not exist on a not-yet-migrated database;
      // connectivity already passed, so this stays unknown rather than failing.
      migrationsApplied = null;
    }
    return NextResponse.json({
      status: "ok",
      database: "connected",
      migrationsApplied,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    // Never leak connection strings or driver errors in the readiness body.
    return NextResponse.json(
      {
        status: "unavailable",
        database: "unreachable",
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
