# Phase 0 — GitHub Checkpoint Plan (prepared, NOT executed)

Nothing has been staged, committed or pushed. This plan lists exactly what would
be staged after explicit approval, what is deliberately excluded, and why.

## Current branch and remote state

| Item | Value |
| --- | --- |
| Branch | `freebuff/ddf1b72a53f48002d6557b62` |
| HEAD | `35afb7ccecd4a28df66b8d5702b0882ec58591dd` |
| `origin/main` | `35afb7ccecd4a28df66b8d5702b0882ec58591dd` (identical to HEAD) |
| Branch on origin | **Does not exist yet** (`git ls-remote --heads origin` returned no ref for it) |
| Divergence | None: HEAD equals `origin/main`, working tree changes are local only |
| Safe to push? | Yes, after approval — the push would **create** the feature branch. No force-push, reset or history rewrite is needed. Pushing to `main` is a separate decision and is not proposed here. |

## Recommended boundary: authentication-only checkpoint

One atomic commit. Includes only the new first-admin mechanism, its tests, the
password-module split those depend on, security-relevant config, and the Phase 0
reports. No product work, no pre-existing dirty files, no R1/R2 artifacts.

### Files to stage (exact list)

| # | Path | Status | Role |
| --- | --- | --- | --- |
| 1 | `src/lib/server/admin-bootstrap.ts` | new | Atomic, one-time first-admin bootstrap |
| 2 | `src/lib/server/admin-bootstrap.test.ts` | new | 8 focused tests |
| 3 | `src/lib/server/password-core.ts` | new | Unguarded scrypt primitive reused by the CLI |
| 4 | `src/lib/server/password.ts` | modified | Guarded `server-only` facade re-exporting the core |
| 5 | `scripts/create-first-admin.ts` | new | Operator CLI (confirmation guard, hidden/ENV password, no secret logging) |
| 6 | `package.json` | modified | Adds `admin:create` script only (no dependency change) |
| 7 | `.env.example` | modified | Documents `TOTP_ENCRYPTION_KEY` and the bootstrap confirmation name |
| 8 | `.gitignore` | modified | `.env*` ignored except `.env.example` |
| 9 | `artifacts/phase0/WORKSPACE_BASELINE.md` | new | Stage 0 evidence |
| 10 | `artifacts/phase0/AUTHENTICATION_ARCHITECTURE_AUDIT.md` | new | Stage 1 evidence |
| 11 | `artifacts/phase0/AIAgent_VERCEL_ENVIRONMENT_REQUIREMENTS.md` | new | Stage 3 evidence |
| 12 | `artifacts/phase0/GITHUB_CHECKPOINT_PLAN.md` | new | This plan |
| 13 | `artifacts/phase0/AGENT_AUTH_GITHUB_EXECUTION_REPORT.md` | new | Stage 7 evidence |

Files 1–5 must be committed together: `password.ts` becomes a facade over
`password-core.ts`, and the CLI imports the core.

### Files explicitly excluded (and reasons)

| Path / group | Reason |
| --- | --- |
| `prisma/schema.prisma` (M, +140 lines) | Pre-existing Phase 4.7B/4.7C skill-candidate/activation models. Not part of auth; auth needs no schema change. |
| `prisma/migrations/20260930130000_phase4_7b_skill_candidates/` | Untracked pre-existing skill work. Excluded to keep the auth checkpoint reviewable. |
| `prisma/migrations/20260930140000_phase4_7c_skill_activation/` | Same. |
| `src/app/growth/page.tsx` (M) | Pre-existing Phase 4.7D growth UI work. |
| `src/components/AppShell.tsx` (M) | Pre-existing navigation change. |
| `src/lib/agent-task.ts` (M) | Pre-existing execution work. |
| `src/lib/integrations/permissions.ts`, `registry.ts`, `registry.test.ts` (M) | Pre-existing skill integration work. |
| `src/lib/server/execution-orchestrator.ts` (M) | Pre-existing execution work. |
| `src/lib/product-factory/**` | Phase 4.7D.1 product source, including the uncommitted `illustrations.ts` `altText` fix. Product work, not auth. |
| `scripts/build-hcab-playbook.ts` | Phase 4.7D.1 build script. |
| `src/lib/server/growth/**`, `src/app/api/growth/**` | Phase 4.7D growth feature. |
| `src/lib/server/skill-candidates/**`, `skill-activation/**`, `src/app/api/skill-candidates/**`, `src/app/skill-candidates/**`, `src/lib/integrations/adapters/{github-skill-discovery,trusted-skill-executor}.ts` (+ test) | Phase 4.7B/4.7C skill feature. |
| `artifacts/phase4-7b*`, `phase4-7c*`, `phase4-7d*`, `phase4-7d1/**`, `phase4-7d2/**` | Product evidence (4.4 MB), including R1 preserved package, R2 package/previews, customer bundle, free sample, manifest/checksums and QA evidence. Protected: never overwritten and not mixed into an auth checkpoint. |
| `node_modules/`, `.next/`, `.vercel/`, any `.env*` except `.env.example` | Ignored build output / environment files. Verified no credential or local database file is in the candidate list. |

No generated secret, real credential, customer PII or local database file is
among the staged candidates.

### Proposed staging commands (after approval only)

```
git add -- \
  src/lib/server/admin-bootstrap.ts \
  src/lib/server/admin-bootstrap.test.ts \
  src/lib/server/password-core.ts \
  src/lib/server/password.ts \
  scripts/create-first-admin.ts \
  package.json .env.example .gitignore \
  artifacts/phase0/WORKSPACE_BASELINE.md \
  artifacts/phase0/AUTHENTICATION_ARCHITECTURE_AUDIT.md \
  artifacts/phase0/AIAgent_VERCEL_ENVIRONMENT_REQUIREMENTS.md \
  artifacts/phase0/GITHUB_CHECKPOINT_PLAN.md \
  artifacts/phase0/AGENT_AUTH_GITHUB_EXECUTION_REPORT.md
git status --short          # confirm only intended paths are staged
git diff --cached --stat    # review scope
git diff --cached           # review content; check for secrets
```

Then re-verify R2 before committing:

```
sha256sum artifacts/phase4-7d1/home-coloring-activity-playbook/printable/home-coloring-activity-playbook.pdf
# must remain 5ac514bfe28e2484b6a37ceaf7c6681382b1a1e0c076f9dac2543bdb076ecd68
```

Expected commit message (one commit):

```
feat(auth): add atomic one-time first-admin bootstrap

AIAgent had no way to create an administrator: registration forces USER and
the seed creates no users. Add a CLI-only bootstrap that reuses the existing
scrypt hashing, runs in a Serializable transaction behind a PostgreSQL
advisory lock, and closes permanently once an ADMIN exists. Document the
independent Vercel environment and the exact checkpoint boundary.
```

### Alternate boundary (only if the owner asks for it)

A second, separate checkpoint could include the Phase 4.7D.1/4.7D.2 product
work and the `altText` fix. That is deliberately **not** proposed here: it is a
different concern, touches 60+ files and binary evidence, and must be reviewed
on its own. R1/R2 would still be included as-is, never regenerated.

## Push policy

- Push only the feature branch, only after explicit approval.
- `git push` (no `--force`) to `origin freebuff/ddf1b72a53f48002d6557b62`.
- Do not merge to `main` or deploy as part of the checkpoint without a separate
  approval.
- If the remote branch appears between now and the push, fetch and rebase
  normally; never force.
