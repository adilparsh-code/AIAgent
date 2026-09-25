# Production migration safety — index creation

This runbook covers one operational question: **how to add an index to a large
production table without blocking writes.**

## The problem

Every index in `prisma/migrations/` up to and including
`20260925120000_high4_one_experiment_per_handoff` was created with an ordinary
`CREATE INDEX` / `CREATE UNIQUE INDEX`. On PostgreSQL that takes a `SHARE` lock
on the table for the duration of the build. Writes are not blocked outright,
but they queue behind the lock, so on a large, hot table an index build can
stall user-facing writes for as long as the build takes — and for a unique
index that also holds a longer lock while it validates existing rows.

`prisma migrate deploy` runs each migration inside a transaction, so the
concurrent form cannot simply be swapped in: `CREATE INDEX CONCURRENTLY`
cannot run inside a transaction block.

## Why the existing migrations were not rewritten

Rewriting an already-applied migration would change its checksum. Every
environment that has already run it would then fail `migrate deploy` with a
drift error, and the correct repair is a manual history edit — which this
project does not do. The existing migrations are therefore left exactly as
they are. This is a known, accepted limitation, recorded here rather than
silently ignored.

## Procedure for a new index on a large production table

1. **Prefer the schema, not raw SQL, when the table is small.** For a table
   that is still small in production, add `@@index(...)` to
   `prisma/schema.prisma`, let Prisma generate the migration, and deploy
   normally. This is what every index in this repository has done so far.

2. **For a large table, add the index concurrently and OUTSIDE a transaction.**
   Create a migration whose `migration.sql` contains:

   ```sql
   -- Run manually, outside `prisma migrate deploy`:
   --   CREATE INDEX CONCURRENTLY "Example_col_idx" ON "Example"("col");
   ```

   then record it in the migration manifest (`src/lib/server/migration-manifest.ts`)
   only after the concurrent build has actually completed. The readiness
   endpoint (`/api/system/readiness`) reports applied/expected migration
   counts, so a missing entry is visible rather than silent.

3. **Always handle orphans first.** Adding a foreign key to a column that may
   already contain dangling ids will fail mid-deploy. Detach the orphans by
   setting the column to `NULL` (never by deleting the owning row), then add the
   constraint. `20260926001000_medium11_denormalized_foreign_keys` is the
   worked example.

4. **Watch for a failed concurrent build.** `CREATE INDEX CONCURRENTLY` can
   leave an `INVALID` index behind. Before retrying, `DROP INDEX` it
   concurrently; do not leave it in place, because it is maintained (and
   therefore paid for) while not being used for lookups.

5. **Verify after deploying.** `npx prisma migrate status` and
   `GET /api/system/readiness` should both report the migration as applied
   with no missing or incomplete entries.

## Bounded reads

`20260926001000` and the `LIST_READ_LIMITS` cap added alongside it are related
concerns: list reads are now bounded at the repository
(`src/lib/server/repositories/list-limits.ts`) so a single response cannot
become a full-table read. That cap is **not pagination** — a caller that needs
rows beyond the cap still has no way to reach them. Treat the bound as a
safety limit, and add real pagination (cursor-based, with a stable `orderBy`)
before a table is expected to exceed it.
