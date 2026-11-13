# AIAgent — Independent Vercel Environment Requirements

AIAgent is a **separate deployment** from AI Income Lab. It must have its own
database and its own credentials. No value is reproduced in this document; only
variable names, purposes and requirements. Nothing was read from or written to
the Vercel dashboard, and no environment was mutated.

## Variable inventory

Legend — Scope: D = Development, P = Preview, Prod = Production.
"Required" means required for the application to operate; optional integrations
degrade honestly (`NOT_CONFIGURED`) when absent and never fabricate success.

| Variable | Purpose | Required | Scope | Secret | DB dependency |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for all persistence (users, sessions, TOTP, business data) | **Yes** | D, P, Prod | **Yes** | **Yes** — the database itself |
| `TOTP_ENCRYPTION_KEY` | 32 random bytes (hex) used to encrypt TOTP secrets and recovery codes at rest (`secret-box.ts`) | Yes **if 2FA is used**; recommended always | D, P, Prod | **Yes** | Indirect (stored in `TotpSecret`) |
| `AI_PROVIDER_API_KEY` | Generic OpenAI-compatible provider key for agent runtime | Optional (live AI) | D, P, Prod | **Yes** | No |
| `AI_PROVIDER_BASE_URL` | Base URL for the generic provider | Optional | D, P, Prod | No | No |
| `AI_PROVIDER_MODEL` | Model id for the generic provider | Optional | D, P, Prod | No | No |
| `AI_PROVIDER_NAME` | Display name recorded in execution metadata | Optional | D, P, Prod | No | No |
| `AI_PROVIDER_ENV` | `LIVE` / `TEST` label; defaults to `UNKNOWN` | Optional | D, P, Prod | No | No |
| `SAMBANOVA_API_KEY` | SambaNova adapter key | Optional (live AI) | D, P, Prod | **Yes** | No |
| `SAMBANOVA_BASE_URL` | SambaNova endpoint override | Optional | D, P, Prod | No | No |
| `SAMBANOVA_MODEL` | SambaNova model id override | Optional | D, P, Prod | No | No |
| `BRAVE_SEARCH_API_KEY` | Brave web-search evidence provider | Optional | D, P, Prod | **Yes** | No |
| `SERPAPI_API_KEY` | Google Trends via SerpApi | Optional | D, P, Prod | **Yes** | No |
| `RESEARCH_PROVIDER_ENV` | `LIVE` / `TEST` label for research | Optional | D, P, Prod | No | No |
| `GITHUB_TOKEN` **or** `GH_TOKEN` **or** `GITHUB_API_TOKEN` | Read-only GitHub token for skill-candidate discovery (first non-empty wins) | Optional | D, P, Prod | **Yes** | No |
| `AI_INCOME_LAB_HANDOFF_ENDPOINT` | Absolute `https://` URL of the AI Income Lab handoff receiver | Optional (handoff feature) | D, P, Prod | No (URL only) | No |
| `AI_INCOME_LAB_HANDOFF_TOKEN` | Bearer token AIAgent presents to the AI Income Lab receiver (≥ 32 chars) | Optional (handoff feature) | D, P, Prod | **Yes** | No |
| `AI_INCOME_LAB_HANDOFF_TIMEOUT_MS` | Handoff timeout, 1 000–60 000 ms (default 10 000) | Optional | D, P, Prod | No | No |
| `PINTEREST_ACCESS_TOKEN` | Scaffold integration (no live adapter) | Optional | D, P, Prod | **Yes** | No |
| `YOUTUBE_API_KEY` | Scaffold integration (no live adapter) | Optional | D, P, Prod | **Yes** | No |
| `AFFILIATE_NETWORK_API_KEY` | Scaffold integration (no live adapter) | Optional | D, P, Prod | **Yes** | No |
| `MARKETPLACE_API_KEY` | Scaffold integration (no live adapter) | Optional | D, P, Prod | **Yes** | No |
| `ANALYTICS_PLATFORM_API_KEY` | Scaffold integration (no live adapter) | Optional | D, P, Prod | **Yes** | No |
| `NODE_ENV` | Runtime mode; set automatically by Next.js/Vercel | Managed | all | No | No |

Notes:

- **No session secret variable exists.** Sessions are random opaque tokens whose
  SHA-256 digest is stored in PostgreSQL; there is nothing to configure and no
  hardcoded fallback.
- **No admin password variable exists.** The first administrator is created by
  `scripts/create-first-admin.ts` with a password typed/piped at runtime. The
  only bootstrap variables are `ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN` and
  optionally `ADMIN_BOOTSTRAP_PASSWORD` (non-interactive runs). Both are required
  **only for that one command**, not for the running app. Do not add either to
  Vercel's persistent environment.
- The three `AI_INCOME_LAB_HANDOFF_*` variables configure AIAgent's outbound
  handoff feature. They are AIAgent's own configuration (the token is issued for
  AIAgent); they are **not** authentication inputs and must not be AI Income Lab
  session secrets or admin passwords.
- Never create `NEXT_PUBLIC_*` variants of any secret. No variable is exposed to
  the browser bundle.
- `.env.example` lists safe placeholders only; no real value is committed.

## Variables that must NOT be copied from AI Income Lab

AIAgent code references none of AI Income Lab's private configuration. Do not
copy any of the following from the other deployment:

- AI Income Lab's `DATABASE_URL` (or any of its database credentials)
- AI Income Lab's administrator password / bootstrap secret
- AI Income Lab's session secret or signing key
- AI Income Lab's API keys (AI providers, research providers, payments, email)
- AI Income Lab's authentication tokens or OAuth client secrets
- AI Income Lab's own `AI_INCOME_LAB_HANDOFF_TOKEN` identity (the handoff token
  must be a token issued for AIAgent; do not reuse the lab's session/admin
  credentials)

Shared *names* such as `DATABASE_URL` or `BRAVE_SEARCH_API_KEY` must be given
AIAgent's **own** values. Using a shared provider account/key is acceptable only
if the owner deliberately chooses so and the key is not scoped to the other
app's data; a shared database is not acceptable (see below).

## Database requirement

**Yes — AIAgent needs its own PostgreSQL database.** It cannot reuse AI Income
Lab's database: both apps run Prisma migrations against their own schema
history, and sharing one database would couple credentials, data and migration
state between the deployments.

Compatible configuration:

- PostgreSQL 14+ managed instance/database, reachable from Vercel over TLS.
- Prisma 5.22, `provider = "postgresql"`, `url = env("DATABASE_URL")`. The schema
  has no `directUrl`, so a single URL is used for both runtime and migrations.
- Serverless-friendly connection pooling is strongly recommended (pooled runtime
  URL). For `prisma migrate deploy`, run the command once against a **direct**
  (non-pooled) connection by temporarily supplying that URL as `DATABASE_URL` to
  the command; no code change is needed.
- Any managed PostgreSQL provider works (e.g. Neon, Supabase, Vercel Postgres,
  RDS). Selection and provisioning are the owner's decision; **nothing was
  provisioned** in this mission and no paid service was created.
- Apply the **committed** migrations only: `npx prisma migrate deploy`.
  Authentication needs nothing beyond the committed schema (the `role` column
  arrived in `20260923120000_phase6a_auth_multitenancy`; TOTP in
  `20260930120000_totp_second_factor`). The two untracked Phase 4.7B/4.7C skill
  migrations are unrelated to auth and are excluded from the auth checkpoint.
- Do not run `prisma migrate dev` or any destructive migration against
  production.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Install command | `npm ci` (uses the committed `package-lock.json`; `postinstall` runs `prisma generate`) |
| Build command | `npm run build` |
| Output | Next.js default (`.next`) |
| Node.js | 20.x LTS (Next.js 14 supported); the app has no `engines` pin |
| Environment scopes | Development / Preview / Production set independently; use a separate database or branch for Preview |

## Independent-deployment checklist (operator)

1. Create a separate PostgreSQL database for AIAgent.
2. Add `DATABASE_URL` and `TOTP_ENCRYPTION_KEY` to the Vercel project
   (Production, and separately Preview if previews should work).
3. Deploy once (build only; no automatic data changes).
4. Run `npx prisma migrate deploy` once against that database.
5. Create the first administrator with `npm run admin:create -- --email …`
   (see the final execution report), then sign in and enroll 2FA.
6. Add optional provider keys only when that capability is actually needed.
7. Verify `/login` loads, unauthenticated APIs return 401, and the new admin can
   sign in. Do not treat a build as proof of login.
