import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { evaluateMigrationReadiness, type MigrationRow } from "@/lib/server/migration-readiness";

/**
 * GET /api/system/readiness — Phase 25 unauthenticated deployment readiness.
 *
 * Deliberately minimal and safe to expose publicly:
 * - verifies DATABASE connectivity with a trivial query (deployment monitors
 *   need a real connectivity signal, not just HTTP 200);
 * - HIGH-6: verifies the FULL expected migration manifest, not merely that a
 *   row exists in `_prisma_migrations`. Missing, failed, rolled-back and
 *   incomplete migrations all report `migrationsApplied: false`;
 * - returns NO user data, NO provider names/statuses, and NO secrets, and only
 *   aggregate migration counts — never migration names or query text. Those
 *   live behind the authenticated /api/system/* surfaces.
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
    let migrations: {
      expected: number;
      applied: number;
      missing: number;
      incomplete: number;
      rolledBack: number;
      unexpected: number;
    } | null = null;
    try {
      const rows = await prisma.$queryRaw<
        Array<{ name: string; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number | null }>
      >`SELECT name, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations"`;
      const readiness = evaluateMigrationReadiness(
        rows.map<MigrationRow>((row) => ({
          name: row.name,
          finishedAt: row.finished_at,
          rolledBackAt: row.rolled_back_at,
          appliedStepsCount: row.applied_steps_count,
        })),
      );
      migrationsApplied = readiness.migrationsApplied;
      migrations = {
        expected: readiness.expectedCount,
        applied: readiness.appliedCount,
        missing: readiness.missing.length,
        incomplete: readiness.incomplete.length,
        rolledBack: readiness.rolledBack.length,
        unexpected: readiness.unexpected.length,
      };
    } catch {
      // The migrations table may not exist on a not-yet-migrated database;
      // connectivity already passed, so this stays unknown rather than failing.
      migrationsApplied = null;
    }
    return NextResponse.json({
      status: "ok",
      database: "connected",
      migrationsApplied,
      migrations,
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
