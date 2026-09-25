/**
 * HIGH-6 — migration readiness evaluated against the expected manifest.
 *
 * Pure, so every failure mode (empty, partial, failed, rolled back, incomplete,
 * unexpected) is directly testable without a database. The readiness route
 * supplies the live `_prisma_migrations` rows; this module decides.
 */
import { EXPECTED_MIGRATIONS } from "./migration-manifest";

/** One row of Prisma's `_prisma_migrations` table, as readiness needs it. */
export interface MigrationRow {
  name: string;
  /** Set when the migration finished successfully. */
  finishedAt: Date | null;
  /** Set when the migration was rolled back. */
  rolledBackAt: Date | null;
  /** Number of applied steps; 0 or null means it never completed. */
  appliedStepsCount: number | null;
}

export interface MigrationReadiness {
  /** True only when every expected migration is present and successfully applied. */
  migrationsApplied: boolean;
  expectedCount: number;
  appliedCount: number;
  /** Expected migrations with no row at all. */
  missing: string[];
  /** Rows that started but never finished (includes failed migrations). */
  incomplete: string[];
  /** Rows that were rolled back. */
  rolledBack: string[];
  /** Rows that are not part of the expected manifest. */
  unexpected: string[];
  /** True when a row exists for an expected migration but is not usable. */
  hasUnusableRows: boolean;
}

/**
 * A migration is "applied" only when it finished, was not rolled back, and
 * actually recorded applied steps. A rolled-back row never satisfies its
 * expected migration, even though the row exists.
 */
export function evaluateMigrationReadiness(
  rows: readonly MigrationRow[],
  expected: readonly string[] = EXPECTED_MIGRATIONS,
): MigrationReadiness {
  const expectedSet = new Set(expected);
  const byName = new Map<string, MigrationRow>();
  for (const row of rows) {
    // A repeated name (e.g. a re-applied migration) is judged by its latest row.
    const previous = byName.get(row.name);
    if (!previous) {
      byName.set(row.name, row);
      continue;
    }
    const previousFinished = previous.finishedAt !== null && previous.rolledBackAt === null;
    const currentFinished = row.finishedAt !== null && row.rolledBackAt === null;
    if (!previousFinished || currentFinished) byName.set(row.name, row);
  }

  const missing: string[] = [];
  const incomplete: string[] = [];
  const rolledBack: string[] = [];
  let appliedCount = 0;

  for (const name of expected) {
    const row = byName.get(name);
    if (!row) {
      missing.push(name);
      continue;
    }
    if (row.rolledBackAt !== null) {
      rolledBack.push(name);
      continue;
    }
    const steps = row.appliedStepsCount ?? 0;
    if (row.finishedAt === null || steps <= 0) {
      incomplete.push(name);
      continue;
    }
    appliedCount += 1;
  }

  const unexpected = rows
    .map((row) => row.name)
    .filter((name) => !expectedSet.has(name));

  const hasUnusableRows = incomplete.length > 0 || rolledBack.length > 0;

  return {
    // An unexpected extra migration is reported but does not by itself mean the
    // expected schema is missing; a missing/failed/rolled-back migration does.
    migrationsApplied: missing.length === 0 && !hasUnusableRows && expected.length > 0,
    expectedCount: expected.length,
    appliedCount,
    missing,
    incomplete,
    rolledBack,
    unexpected,
    hasUnusableRows,
  };
}
