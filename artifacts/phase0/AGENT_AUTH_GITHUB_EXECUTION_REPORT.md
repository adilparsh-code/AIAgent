# AIAgent — Authentication Setup, Secure First Admin, Vercel Readiness & GitHub Checkpoint

Execution report — Phase 0 mission. **Stopped at the approval gate.**
Nothing was committed, pushed, deployed, migrated, or provisioned. No secret is
reproduced in this report.

## 1. Executive summary

AIAgent already had a complete custom authentication stack (login, register,
scrypt hashing, database-backed sessions, roles, TOTP 2FA, rate limiting) but
**no way to create an administrator**: `registerUser` hardcodes `role: "USER"`,
the seed creates no users, and no bootstrap existed. That is the only functional
gap preventing a first sign-in with administrative rights.

This mission adds the smallest secure closure of that gap:

- `src/lib/server/admin-bootstrap.ts` — one-time first-admin creation, CLI-only,
  atomic against concurrency, reusing existing scrypt hashing and the existing
  `User.role` column. **No schema change, no migration, no public endpoint.**
- `scripts/create-first-admin.ts` — operator command with an explicit
  confirmation guard, hidden password prompt (or a one-shot environment value),
  and no password/token logging.
- 8 new focused tests (success, duplicate, concurrency, confirmation, invalid
  email, weak password, taken email, hashing/no-plaintext).
- Independent Vercel environment inventory, baseline evidence, checkpoint plan,
  and this report under `artifacts/phase0/`.

Everything was verified statically and with unit tests; **real login and admin
authorization remain BLOCKED** because no `DATABASE_URL`/PostgreSQL is
configured in this workspace. No production claim is made.

## 2. Baseline branch and HEAD

| Item | Value |
| --- | --- |
| Repository | `adilparsh-code/AIAgent` |
| Branch | `freebuff/ddf1b72a53f48002d6557b62` |
| HEAD | `35afb7ccecd4a28df66b8d5702b0882ec58591dd` |
| Reported HEAD | same — matches |
| `origin/main` | `35afb7ccecd4a28df66b8d5702b0882ec58591dd` (HEAD equals main) |
| Feature branch on origin | not present; push would create it, no force needed |

All pre-existing dirty/untracked work was preserved. R2 was not regenerated:
`artifacts/phase4-7d1/home-coloring-activity-playbook/printable/home-coloring-activity-playbook.pdf`
still hashes to `5ac514bfe28e2484b6a37ceaf7c6681382b1a1e0c076f9dac2543bdb076ecd68`
(identity `home-coloring-activity-playbook@1.0.0+5ac514bfe28e2484`). R1
preserved evidence is intact. Details: `WORKSPACE_BASELINE.md`.

## 3. Authentication architecture

Custom first-party auth on Next.js 14.2.5 (App Router) + Prisma 5.22 +
PostgreSQL; no third-party auth provider.

- **Login**: `src/app/login/page.tsx` → `POST /api/auth/login`; rate-limited,
  generic failures, dummy-hash timing equalization, TOTP step when enrolled.
- **Registration**: `POST /api/auth/register` forces `role: "USER"` and
  rate-limits; it cannot create an admin.
- **Sessions**: opaque random token; only its SHA-256 digest stored; 7-day TTL;
  `ail_session` cookie with `HttpOnly`, `SameSite=Lax`, `Secure` in production;
  logout/delete revokes rows. `GET /api/auth/me` returns identity or 401.
- **Hashing**: Node scrypt, N=16384/r=8/p=1, 64-byte key, 16-byte random salt,
  self-describing `scrypt$N$r$p$salt$hash`, `timingSafeEqual` verification.
  `password.ts` is a `server-only` facade over the new `password-core.ts` so the
  operator CLI can reuse the exact primitive outside the Next RSC condition.
- **Authorization**: `requireUser`, `requireAdmin`, `requireOwnership` in
  `authz.ts` verify against the database on the server. Middleware only performs
  an optimistic cookie-presence redirect for pages; it is not trusted for APIs.
- **2FA**: TOTP secrets encrypted at rest with `TOTP_ENCRYPTION_KEY`.
- **Database**: PostgreSQL only; `getPrisma()` raises `DbUnavailableError` when
  `DATABASE_URL` is missing, and routes return an honest 503 — no in-memory
  fallback, no fabricated persistence.

Full detail: `AUTHENTICATION_ARCHITECTURE_AUDIT.md`.

## 4. First-admin implementation

### How it works

`createFirstAdmin(prisma, { email, password, name?, confirmation })`:

1. Requires `confirmation === "CREATE_FIRST_ADMIN"` (fail closed).
2. Validates/normalizes email, requires a ≥ 12-character admin password,
   trims the optional name.
3. Hashes with the existing scrypt implementation **before** the transaction.
4. Opens a `Serializable` transaction and takes
   `pg_advisory_xact_lock(hashtext('aiagent:first-admin-bootstrap')::bigint)`.
5. Inside the lock: re-checks `User.role = ADMIN`; refuses if one exists;
   refuses if the email is already used (any role).
6. Creates the user with `role: "ADMIN"`, `status: "ACTIVE"` explicitly.
   Role/status never come from request input — no mass assignment.
7. Commits; the transaction-scoped lock releases. A second concurrent run sees
   the new admin and is rejected. A unique-email constraint is a second guard.

There is **no HTTP route**. The only entry point is the operator CLI
`scripts/create-first-admin.ts` (`npm run admin:create`), so the public internet
cannot claim ADMIN. No bootstrap token exists, so there is no token to reuse or
leak; the bootstrap closes permanently once any ADMIN exists.

### Operator instructions

Interactive (recommended; password input is hidden):

```
DATABASE_URL=... ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN \
  npm run admin:create -- --email owner@example.com --name "Owner"
```

Non-interactive provisioning (avoid shell history where possible):

```
ADMIN_BOOTSTRAP_PASSWORD='...' \
ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN \
DATABASE_URL=... \
  npm run admin:create -- --email owner@example.com
```

Then sign in at `/login` and enroll TOTP under Settings. Run this **after**
`npx prisma migrate deploy` and **before** handing the deployment to users.
The command refuses to run again while an admin exists. Never put
`ADMIN_BOOTSTRAP_PASSWORD` or `ADMIN_BOOTSTRAP_CONFIRM` in the persistent
Vercel environment.

### Database requirements

PostgreSQL 14+; no new table, column or migration. `User.role`, `User.status`,
`Session`, `TotpSecret` all already exist in committed migrations. Auth needs
migrations up to and including `20260923120000_phase6a_auth_multitenancy`
(plus `20260930120000_totp_second_factor` for 2FA). The two untracked Phase
4.7B/4.7C skill migrations are unrelated and excluded from the auth checkpoint.

## 5. Vercel environment requirements

AIAgent is a separate deployment and needs **its own PostgreSQL database**; do
not reuse AI Income Lab's `DATABASE_URL`, admin password, session secret, API
keys or auth tokens. Required for operation: `DATABASE_URL`; required for 2FA:
`TOTP_ENCRYPTION_KEY`. Everything else is optional and degrades honestly
(`NOT_CONFIGURED`) when absent. Full table (including AI provider, research,
GitHub discovery, scaffold and `AI_INCOME_LAB_HANDOFF_*` variables) and the
independent-deployment checklist: `AIAgent_VERCEL_ENVIRONMENT_REQUIREMENTS.md`.

No Vercel environment was inspected or mutated; no database was provisioned.

## 6. Security measures

- No hardcoded or committed admin password; password supplied at runtime only.
- No plaintext password stored, returned or logged; scrypt only.
- One-time bootstrap, atomic (Serializable + advisory lock), fails closed.
- No public registration path to ADMIN; role/status assigned server-side.
- Admin APIs still require a verified database session and `ADMIN` role.
- Confirmation guard prevents accidental admin creation.
- CLI withholds arbitrary database error text so connection details cannot leak.
- `.env*` now ignored except `.env.example`; no credential is in the staging
  candidate list.
- Session cookies remain `HttpOnly`/`Secure`/`SameSite=Lax`; hashed tokens at rest.
- No dependency upgraded; no auth mechanism weakened; middleware untouched.

## 7. Tests and build evidence

| Check | Command | Result |
| --- | --- | --- |
| New bootstrap tests + hashing | `npx vitest run src/lib/server/admin-bootstrap.test.ts src/lib/server/password.test.ts` | **PASS** — 2 files, 12 tests |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **PASS** — exit 0 |
| Lint | `npm run lint` | **PASS** — no warnings/errors |
| Production build | `npm run build` | **PASS** — exit 0, `/login`, `/register`, `/settings` and APIs compiled |
| Full suite | `npx vitest run` | **856 passed, 2 failed, 6 skipped**; 19 files fail on `DbUnavailableError` (no `DATABASE_URL`). Baseline was 848 passed / 2 failed / 6 skipped — the +8 are the new tests; the 2 failures are the same pre-existing `agent-task` and migration-manifest failures. Not a green run. |
| Login page loads | dev server `:3100`, `GET /login` | **PASS** — 200, renders "Sign in"; no env value in HTML |
| Unauthenticated API | `GET /api/auth/me`, `POST /api/agents` | **PASS** — 401 |
| Protected page | `GET /settings` | **PASS** — 307 → `/login?returnTo=%2Fsettings` |
| Invalid credentials | `POST /api/auth/login` (no DB) | **BLOCKED** — 503 `{"error":"DATABASE_URL is not configured"}` |
| CLI without database | `npm run admin:create` with `DATABASE_URL` unset | **PASS (fail closed)** — exit 1, safe message |
| CLI without confirmation | unreachable `DATABASE_URL` + password, no confirmation | **PASS (fail closed)** — exit 1, `CONFIRMATION_REQUIRED`; no DB connection attempted |
| Real admin creation / login success / session validation / non-admin 403 | requires PostgreSQL | **BLOCKED** — no database in this workspace; existing DB-gated tests skip |

The only source change needed for a green typecheck outside auth was a missing
parameter type in the untracked Phase 4.7D.2 sample generator
(`artifacts/phase4-7d2/free-sample/build-sample.ts`), which is excluded from the
checkpoint.

## 8. Unresolved blockers

1. **No PostgreSQL/DATABASE_URL** here, so a real first admin, real login, real
   session validation and live non-admin 403 could not be executed. Reported as
   BLOCKED, not passed.
2. **No production Vercel configuration** and no authorization to change it;
   production readiness is therefore **NOT_VERIFIED**.
3. **No admin-existence check** against any deployed database (would require
   credentials); fresh databases have none by construction.
4. 19 test files and 2 pre-existing tests are red for reasons unrelated to this
   mission (missing DB, uncommitted skill migrations, existing `agent-task`
   failure).

## 9. GitHub staging plan

Recommended: one **authentication-only** commit of 13 files (bootstrap module and
test, `password-core.ts`, `password.ts` facade, CLI, `package.json`,
`.env.example`, `.gitignore`, and the five `artifacts/phase0/` reports).
Everything else — pre-existing modified product files, Phase 4.7B/4.7C
migrations and skill code, Phase 4.7D.1/4.7D.2 product source and all
`artifacts/phase4-7*` evidence including R1/R2 — is excluded with reasons.
Exact list, commands, verification steps and commit message:
`GITHUB_CHECKPOINT_PLAN.md`. **Nothing is staged.**

## 10. Explicit approval items

Approval is requested separately for each of:

1. Staging the 13 listed files and committing them.
2. Pushing `freebuff/ddf1b72a53f48002d6557b62` to `origin` (creates the branch).
3. Provisioning/modifying a production PostgreSQL database and running
   `prisma migrate deploy`.
4. Adding/changing any Vercel environment variable.
5. Creating the production administrator account.
6. Deploying to Vercel.
7. Any merge to `main`.

## 11. Phase 4.7D.3 readiness

Phase 4.7D.3 was **not started**. The authentication foundation it would depend
on is now present and verified at the unit/build level: a secure first admin can
be created once, login/session/role enforcement already exist, and the
deployment configuration is documented. Phase 4.7D.3 should wait until a real
database is provisioned, migrations applied, an admin created, and a real login
verified on the deployed origin.

## 12. Verification statement

Evidence in this report comes from the commands and inspections listed above.
No test, deployment, remote write, migration or production authentication is
claimed beyond what those checks actually proved. The full suite is red for the
pre-existing reasons stated, not green.
