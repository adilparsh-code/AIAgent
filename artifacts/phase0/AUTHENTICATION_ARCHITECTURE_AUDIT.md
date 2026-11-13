# Phase 0 — Authentication Architecture Audit (AIAgent)

Audit of the actual application code. No password hash, credential, cookie or
secret value is reproduced here.

## Stack

| Concern | Implementation |
| --- | --- |
| Framework | Next.js `14.2.5`, App Router, TypeScript strict |
| Auth model | Custom first-party auth (no NextAuth/Clerk/Auth0) |
| Database | PostgreSQL via Prisma `^5.22.0` (`@prisma/client` 5.22.0) |
| Password hashing | Node `scrypt` (`N=16384, r=8, p=1`, 64-byte key, 16-byte random salt) |
| Sessions | Opaque random token, SHA-256 hashed at rest, `ail_session` cookie |
| 2FA | TOTP (RFC 6238) with encrypted secrets and recovery codes |

## Entry points

| Path | Purpose |
| --- | --- |
| `src/app/login/page.tsx` | Login page (email + password, optional TOTP step) |
| `src/app/register/page.tsx` | Self-service registration page |
| `POST /api/auth/register` | Creates a `USER` (rate-limited) |
| `POST /api/auth/login` | Verifies credentials, optional TOTP, issues session |
| `POST /api/auth/logout` | Revokes the server-side session |
| `GET /api/auth/me` | Returns the session identity or 401 |
| `GET/DELETE /api/auth/sessions` | Lists/revokes the user's sessions |
| `/api/auth/totp/*` | Enroll, verify, disable, recovery codes |
| `src/middleware.ts` | Optimistic page gate: redirects to `/login` when the cookie is absent |

Server logic lives in `src/lib/server/`: `auth-service.ts`, `session.ts`,
`password.ts` (guarded facade), `password-core.ts` (scrypt primitive),
`authz.ts`, `secret-box.ts`.

## Answers to the audit questions

1. **Is the login page connected to a functional backend?**
   Yes. The page posts to `POST /api/auth/login`, which resolves the user,
   verifies the scrypt hash, handles TOTP, creates a database-backed session and
   sets the cookie. No mocked or client-only auth path exists.

2. **Is a user model available?**
   Yes. Prisma `User` has unique `email`, `passwordHash`, `name`, `role`
   (`USER`/`ADMIN`), `status`, timestamps, plus `Session`, `TotpSecret` and
   `TotpRecoveryCode` models. `role` was added by the committed migration
   `20260923120000_phase6a_auth_multitenancy`.

3. **Does an admin user exist?**
   **NOT_VERIFIED.** There is no safe metadata-only way to query the deployed
   database from this workspace (no `DATABASE_URL`). The seed script creates
   sample business data only and **no users**. Registration always forces
   `role: "USER"`. No code path could have created an administrator before this
   mission, so a fresh database has none.

4. **Is there a secure first-admin creation mechanism?**
   **None existed.** `registerUser` hardcodes `role: "USER"`, the seed creates no
   users, and no CLI/bootstrap script existed. This gap is now closed by
   `src/lib/server/admin-bootstrap.ts` + `scripts/create-first-admin.ts` (see the
   final execution report). It is CLI-only: no HTTP route, so the public cannot
   claim ADMIN.

5. **Which database is required?**
   PostgreSQL. `DATABASE_URL` is the single persistence configuration; without
   it, `getPrisma()` raises `DbUnavailableError` and API routes fail closed
   (503 / honest error), never falling back to memory.

6. **Does the application use Prisma, and which version?**
   Yes — Prisma `^5.22.0` (client and CLI 5.22.0), schema provider
   `postgresql`. 19 migration directories exist on disk (17 committed; the two
   Phase 4.7B/4.7C skill migrations are untracked and unrelated to auth).

7. **What prevents successful login right now?**
   In this workspace: `DATABASE_URL` is not configured, so `POST /api/auth/login`
   returns `503 {"error":"DATABASE_URL is not configured"}`. In a configured
   deployment: no account or administrator exists until either self-registration
   or the new first-admin bootstrap is run. A real login cannot be claimed
   until a database is provisioned and that command is executed.

## Session and authorization design (verified by code inspection)

- Session token: high-entropy random value; only its SHA-256 digest is stored in
  `Session.tokenHash`; 7-day TTL; revoked by logout/delete.
- Cookie: `ail_session`, `HttpOnly`, `SameSite=Lax`, `Secure` when
  `NODE_ENV=production`, path `/`.
- Login: rate-limited per identity; generic invalid-credentials message; a dummy
  hash equalizes timing for unknown emails; failures are not distinguished.
- `src/middleware.ts` only checks cookie presence for page navigation. It is
  **not** the authorization boundary: every API route re-validates the session
  server-side (`getSessionUser` / `requireUser`).
- Roles: `requireAdmin` checks the database role, not the client. Example:
  `POST /api/agents` calls `requireAdmin` and returns 401/403 accordingly.
- `requireOwnership` derives the owner from the session, never from request
  body input, preventing horizontal privilege escalation.
- No mass assignment: registration explicitly picks fields and forces
  `role: "USER"`; OpenAI/authz decisions never read a client-supplied role.

## Gaps found and disposition

| Gap | Disposition |
| --- | --- |
| No first-admin mechanism | Implemented as an atomic, one-time, CLI-only bootstrap (no public endpoint, no schema change) |
| Bootstrapping could race | Serializable transaction + `pg_advisory_xact_lock('aiagent:first-admin-bootstrap')`, re-check inside the lock |
| `TOTP_ENCRYPTION_KEY` not documented in `.env.example` | Added (name only, no value) |
| `.gitignore` ignored `.env` but not e.g. `.env.production` | Tightened to `.env*` with `!.env.example` |
| Real login/session/admin checks need PostgreSQL | Existing DB-gated tests skip here; reported BLOCKED, not fabricated |

## Existing test coverage relevant to authentication

`src/lib/server/auth-multitenancy.test.ts` (DB-gated): registration + session
identity, cross-tenant isolation, unauthenticated `/api/auth/me` rejection,
invalid-password login, logout revocation, `USER` → admin-route 403.
`src/lib/server/password.test.ts`: scrypt round-trip, wrong password, unique
salt, malformed-hash refusal.
`src/lib/server/totp-flow.test.ts`, `rate-limit-identity.test.ts`,
`live-execution.test.ts`, route-parity suites: login success and operational
authorization (DB-gated where persistence is involved).
