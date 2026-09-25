/**
 * HIGH-6 regression suite: readiness verifies the migration manifest, not the
 * mere existence of a `_prisma_migrations` row.
 *
 * The bug this locks down: readiness ran
 * `SELECT name FROM "_prisma_migrations" LIMIT 1` and reported
 * `migrationsApplied: true` as soon as any single row existed, so a database
 * missing most migrations (or holding a failed/rolled-back one) was reported
 * as ready.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_MIGRATIONS } from "./migration-manifest";
import { evaluateMigrationReadiness, type MigrationRow } from "./migration-readiness";

const FINISHED = new Date("2026-01-01T00:00:00.000Z");

function row(name: string, overrides: Partial<MigrationRow> = {}): MigrationRow {
  return {
    name,
    finishedAt: FINISHED,
    rolledBackAt: null,
    appliedStepsCount: 1,
    ...overrides,
  };
}

function fullyMigrated(extra: MigrationRow[] = []): MigrationRow[] {
  return [...EXPECTED_MIGRATIONS.map((name) => row(name)), ...extra];
}

describe("evaluateMigrationReadiness", () => {
  it("reports applied for a fully migrated database", () => {
    const result = evaluateMigrationReadiness(fullyMigrated());
    expect(result.migrationsApplied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.incomplete).toEqual([]);
    expect(result.rolledBack).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(result.appliedCount).toBe(EXPECTED_MIGRATIONS.length);
    expect(result.expectedCount).toBe(EXPECTED_MIGRATIONS.length);
  });

  it("reports NOT applied for an empty database (the HIGH-6 regression)", () => {
    const result = evaluateMigrationReadiness([]);
    expect(result.migrationsApplied).toBe(false);
    expect(result.missing).toEqual([...EXPECTED_MIGRATIONS]);
    expect(result.appliedCount).toBe(0);
  });

  it("reports NOT applied when only one migration row exists", () => {
    // Exactly the old false positive: a single row used to mean "ready".
    const result = evaluateMigrationReadiness([row(EXPECTED_MIGRATIONS[0]!)]);
    expect(result.migrationsApplied).toBe(false);
    expect(result.missing).toEqual(EXPECTED_MIGRATIONS.slice(1));
    expect(result.appliedCount).toBe(1);
  });

  it("reports NOT applied for a partial database and names what is missing", () => {
    const partial = EXPECTED_MIGRATIONS.slice(0, -2).map((name) => row(name));
    const result = evaluateMigrationReadiness(partial);
    expect(result.migrationsApplied).toBe(false);
    expect(result.missing).toEqual(EXPECTED_MIGRATIONS.slice(-2));
  });

  it("detects a failed / unfinished migration", () => {
    const rows = fullyMigrated();
    const failedName = EXPECTED_MIGRATIONS[3]!;
    rows[3] = row(failedName, { finishedAt: null, appliedStepsCount: 0 });
    const result = evaluateMigrationReadiness(rows);
    expect(result.migrationsApplied).toBe(false);
    expect(result.incomplete).toEqual([failedName]);
    expect(result.appliedCount).toBe(EXPECTED_MIGRATIONS.length - 1);
  });

  it("detects a migration that finished without applying any step", () => {
    const rows = fullyMigrated();
    const name = EXPECTED_MIGRATIONS[5]!;
    rows[5] = row(name, { appliedStepsCount: 0 });
    const result = evaluateMigrationReadiness(rows);
    expect(result.migrationsApplied).toBe(false);
    expect(result.incomplete).toEqual([name]);
  });

  it("detects a rolled-back migration", () => {
    const rows = fullyMigrated();
    const rolledBack = EXPECTED_MIGRATIONS[0]!;
    rows[0] = row(rolledBack, { rolledBackAt: FINISHED });
    const result = evaluateMigrationReadiness(rows);
    expect(result.migrationsApplied).toBe(false);
    expect(result.rolledBack).toEqual([rolledBack]);
    // A rolled-back row never satisfies its expected migration.
    expect(result.appliedCount).toBe(EXPECTED_MIGRATIONS.length - 1);
  });

  it("reports unexpected migrations without claiming the expected set is broken", () => {
    const result = evaluateMigrationReadiness(fullyMigrated([row("20260101000000_from_another_branch")]));
    expect(result.unexpected).toEqual(["20260101000000_from_another_branch"]);
    expect(result.migrationsApplied).toBe(true);
  });

  it("reports multiple simultaneous problems at once", () => {
    const rows = fullyMigrated();
    rows[0] = row(EXPECTED_MIGRATIONS[0]!, { rolledBackAt: FINISHED });
    rows[1] = row(EXPECTED_MIGRATIONS[1]!, { finishedAt: null, appliedStepsCount: 0 });
    const result = evaluateMigrationReadiness([...rows.slice(0, -1), row("20260101000000_extra")]);
    expect(result.migrationsApplied).toBe(false);
    expect(result.rolledBack).toEqual([EXPECTED_MIGRATIONS[0]]);
    expect(result.incomplete).toEqual([EXPECTED_MIGRATIONS[1]]);
    expect(result.missing).toEqual([EXPECTED_MIGRATIONS[EXPECTED_MIGRATIONS.length - 1]!]);
    expect(result.unexpected).toEqual(["20260101000000_extra"]);
  });

  it("treats a re-applied migration row as satisfied by the latest successful row", () => {
    const name = EXPECTED_MIGRATIONS[0]!;
    const result = evaluateMigrationReadiness([
      ...fullyMigrated(),
      row(name, { finishedAt: null, appliedStepsCount: 0 }),
    ]);
    expect(result.migrationsApplied).toBe(true);
    expect(result.incomplete).toEqual([]);
  });

  it("never reports applied against an empty expected manifest", () => {
    expect(evaluateMigrationReadiness([], []).migrationsApplied).toBe(false);
  });
});

describe("expected migration manifest", () => {
  it("matches the committed prisma/migrations directories exactly", () => {
    const directory = join(process.cwd(), "prisma", "migrations");
    const onDisk = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...EXPECTED_MIGRATIONS].sort()).toEqual(onDisk);
  });

  it("is ordered and free of duplicates", () => {
    expect(new Set(EXPECTED_MIGRATIONS).size).toBe(EXPECTED_MIGRATIONS.length);
    expect([...EXPECTED_MIGRATIONS]).toEqual([...EXPECTED_MIGRATIONS].sort());
  });
});
