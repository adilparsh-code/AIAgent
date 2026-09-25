# Production Activation Pack

**Status of this document:** implementation-preparation only. NOTHING in this repository is
production-deployed or live-data verified today. Every claim below distinguishes
`IMPLEMENTED` (code exists and is test-verified) from `CONFIGURED` (real credentials present and
recognized) from `VERIFIED` (observed working against real infrastructure) from `NOT VERIFIED`.

Baseline: `main` at `5a8d7ae4d11a8448b363c60e1c180b59666c06dc` (Phase 27 merged, CI green).

Companion documents:

- `docs/PROVIDER_ACTIVATION.md` — provider-by-provider activation matrix
- `docs/FIRST_REAL_LOOP.md` — first real research run, first experiment, REAL_DATA and revenue gates
- `docs/environment.md` — full server-side environment variable reference
- `docs/integrations.md` — integration UI, statuses, data classes, safe execution rules
- `docs/live-activation-runbook.md` — Phase 16/17 controlled live-test order

---

## 1. Activation inventory

Legend: `READY` = verified in this repository/CI · `REQUIRES_CONFIGURATION` = code ready, operator
must supply settings · `REQUIRES_CREDENTIAL` = code ready, operator must supply a secret ·
`REQUIRES_HUMAN_ACTION` = a person must deliberately do something · `NOT_VERIFIED` = cannot be
claimed from this environment · `NOT_APPLICABLE`.

| # | Item | State | Notes |
| --- | --- | --- | --- |
| A1 | Production build compatibility (`next build`) | READY | CI builds on every push; compile + routes verified locally |
| A2 | Production PostgreSQL instance | REQUIRES_CONFIGURATION | No production DB exists in this environment |
| A3 | Schema migrations on production DB | REQUIRES_CONFIGURATION | `prisma migrate deploy` verified only in CI |
| B1 | Auth registration/login/logout/sessions | READY | IMPLEMENTED + test-verified (Phases 6A/6B) |
| B2 | Production secret for session cookies (`Secure` cookie) | NOT_VERIFIED | Cookie is `Secure` in production mode; needs a real HTTPS deployment to verify |
| C1 | `DATABASE_URL` (production) | REQUIRES_CREDENTIAL | Server-only; see environment audit below |
| C2 | Provider API keys (production) | REQUIRES_CREDENTIAL | See provider matrix |
| D1 | SambaNova / AI provider account with credits | REQUIRES_CREDENTIAL | Historically HTTP 402 — key authenticated, account had no credits/subscription |
| E1 | Research provider keys (Brave/SerpApi) | REQUIRES_CREDENTIAL | Reddit needs no key (rate limits may cause FAILED runs) |
| F1 | Provider health checks executed against real accounts | REQUIRES_HUMAN_ACTION | Existing `/integrations` UI + `POST /api/integrations/:id/health` |
| G1 | Hosting environment (Vercel-compatible Node.js target) | REQUIRES_CONFIGURATION | Architecture is Vercel-compatible per README; no committed `vercel.json`/Dockerfile — intended path, NOT VERIFIED |
| G2 | Production deployment executed | REQUIRES_HUMAN_ACTION | Never performed; do not claim |
| H1 | Domain + HTTPS | REQUIRES_CONFIGURATION | Required for `Secure` session cookies in production |
| I1 | Structured server logs (JSON lines) | READY | Implemented; secrets redacted |
| I2 | External uptime/error monitoring | REQUIRES_CONFIGURATION | None integrated by design; operator may add external monitoring — no code change required |
| J1 | Authentication/authorization/multi-tenancy | READY | Verified by Phase 27 audit |
| J2 | Production security review (real deployment surface) | NOT_VERIFIED | Re-check headers, cookies, rate limits after first real deployment |
| K1 | Migration set integrity | READY | CI runs `prisma migrate deploy` on clean Postgres 16 on every push |
| L1 | Database backup/recovery procedure | REQUIRES_CONFIGURATION | Operator-owned; depends on chosen Postgres provider |
| M1 | First real research run | REQUIRES_HUMAN_ACTION | Runbook: `docs/FIRST_REAL_LOOP.md` |
| N1 | First real experiment | REQUIRES_HUMAN_ACTION | Human-controlled; approval gates mandatory |
| O1 | First REAL_DATA metric | NOT_VERIFIED | Requires N1 to actually happen |
| P1 | Revenue feedback on real data | NOT_VERIFIED | Revenue intelligence implemented; reports INSUFFICIENT_DATA until real metrics exist |

## 2. Environment variable audit

Complete `process.env` surface from source (Phase 27 audit). No `NEXT_PUBLIC_*` secret exists; a
dedicated test (`phase17-contract-audit.test.ts`) asserts none is introduced. **Never commit real
values** — placeholders only.

| Variable | Used By | Required? | Server/Client | Purpose | Current Verification |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | `src/lib/db.ts` (all persistence) | REQUIRED (persistence, migrations, live research, agent runs) | Server only | PostgreSQL connection string | CONFIGURED in CI/dev; production NOT VERIFIED |
| `BRAVE_SEARCH_API_KEY` | research providers + `brave-search` integration adapter | Optional (graceful `CONFIG_ERROR` / `NOT_CONFIGURED` without it) | Server only | Web-search evidence (demand, commercial intent, competition) | REQUIRES_CREDENTIAL — never health-verified against a real account in this environment |
| `SERPAPI_API_KEY` | research providers + `google-trends` integration adapter | Optional (graceful degrade) | Server only | Google Trends via SerpApi (relative 0–100 interest) | REQUIRES_CREDENTIAL |
| `SAMBANOVA_API_KEY` | `sambanova` integration adapter | Optional (NOT_CONFIGURED without it; executions UNAVAILABLE — never fabricated) | Server only | LLM drafts/analysis, 1-token health probe | REQUIRES_CREDENTIAL — last real check: HTTP 402 (authenticated, no credits) |
| `SAMBANOVA_BASE_URL` | `sambanova` adapter | Optional | Server only | Override OpenAI-compatible endpoint | NOT_VERIFIED (no real account) |
| `SAMBANOVA_MODEL` | `sambanova` adapter | Optional | Server only | Model id override (code default `Meta-Llama-3.3-70B-Instruct`) | NOT_VERIFIED |
| `AI_PROVIDER_API_KEY` | Phase 7 agent runtime (`ai-provider.ts`) | Optional (runtime reports UNAVAILABLE without it) | Server only | Generic OpenAI-compatible provider for agent runtime | REQUIRES_CREDENTIAL |
| `AI_PROVIDER_BASE_URL` | agent runtime | Optional | Server only | Provider base URL | NOT_VERIFIED |
| `AI_PROVIDER_MODEL` | agent runtime | Optional | Server only | Model id | NOT_VERIFIED |
| `AI_PROVIDER_NAME` | agent runtime | Optional | Server only | Display name in execution metadata | NOT_VERIFIED |
| `AI_PROVIDER_ENV` | `sambanova` adapter | Optional | Server only | `LIVE`/`TEST` environment label (default UNKNOWN) | REQUIRES_CONFIGURATION at activation |
| `RESEARCH_PROVIDER_ENV` | research providers | Optional | Server only | `LIVE`/`TEST` environment label | REQUIRES_CONFIGURATION at activation |
| `NODE_ENV` | Next.js runtime | Automatic | Server | Set by the platform; drives `Secure` cookie behavior | NOT_VERIFIED in production |

Findings from the audit (Step 3):

- No missing variable references, no incorrect naming, no accidental `NEXT_PUBLIC` exposure, no
  client-side secret usage, no obsolete variables found. `docs/environment.md` is the canonical
  reference; one inaccuracy was corrected (SambaNova default model id).
- Missing-variable behavior is fail-closed everywhere: unconfigured providers report
  `NOT_CONFIGURED`/`CONFIG_ERROR`, the DB layer throws `DbUnavailableError` (routes answer 503),
  the readiness endpoint answers 503. Nothing fabricates success.

## 3. Deployment runbook (intended path — NOT VERIFIED)

The repository's actual deployment architecture is Next.js 14 (App Router) + Prisma + PostgreSQL,
Vercel-compatible. **No production deployment has ever been performed.** This runbook documents the
intended path; each checkbox is evidence to be captured at execution time, not a claim.

1. **Provision PostgreSQL** (any Postgres 16+ provider). Capture the connection string as
   `<REQUIRED_SECRET>`. Record: region, version, backup schedule, connection limit.
2. **Configure environment** on the hosting platform (server-side only): `DATABASE_URL` plus the
   provider keys being activated. Set `AI_PROVIDER_ENV=LIVE` / `RESEARCH_PROVIDER_ENV=LIVE` only
   when pointing at real accounts. No secret ever goes into client bundles or the repo.
3. **Deploy migrations:** the platform's build runs `npm ci` → `postinstall` (`prisma generate`) →
   `next build`. Run `npx prisma migrate deploy` against the production `DATABASE_URL` **before**
   first traffic (CI does this automatically; production is a manual/gated step). Evidence:
   migration list output.
4. **Deploy the application** (hosting default for Next.js: `next build` + server runtime). Do not
   point a custom domain before step 5 passes.
5. **Readiness check:** `GET /api/system/readiness` must return 200 with
   `{"status":"ok","database":"connected"}` and `migrationsApplied: true`. A 503 means the database
   is unreachable — stop and fix before continuing. (Unauthenticated by design; exposes no user
   data, counts, provider status, or secrets.)
6. **Authentication test:** register a dedicated operator account via `/register`, log in, confirm
   the session cookie is `HttpOnly`/`Secure`/`SameSite=Lax`, log out, confirm protected pages
   redirect to `/login?returnTo=…`.
7. **Database ownership test:** with two accounts, create an opportunity in account A and confirm
   account B sees neither it nor its existence (404-masking). Confirms multi-tenancy on the real
   deployment.
8. **Provider health checks:** `/integrations` → run health check per provider → confirm persisted
   `IntegrationHealth` rows show truthful statuses (`HEALTHY` / `AUTH_FAILED` / `FAILED` /
   `CREDIT_LIMITED` / `NOT_CONFIGURED`). Configuration alone is never health.
9. **Research smoke test:** follow `docs/FIRST_REAL_LOOP.md` §1 — one bounded, owner-scoped live
   research cycle via `POST /api/research/live-cycle`, reviewed before anything else runs.
10. **Rollback:** see §5 below.

## 4. Observability checklist during first activation

All of the following are observable today through implemented surfaces (structured JSON logs,
`/api/system/health`, `/api/system/operations`, `/api/system/platform`, `/api/system/launch-readiness`,
`/integrations`, `/growth`, `/platform`) — none of them requires new code:

| Signal | Where observable |
| --- | --- |
| Authentication failures / rate limits | auth route responses + structured logs (generic, non-enumerating) |
| Database connectivity | `/api/system/readiness` (public), `/api/system/health` (auth) |
| Provider health + latency + data class | `IntegrationHealth` rows, `/integrations` UI, `POST /api/integrations/:id/health` |
| Research execution + provider statuses | ResearchRun + ResearchSource rows, opportunity page history, logs (`research.started/completed/failed`) |
| Evidence provenance | per-evidence source/URL/hash/dataClass in run result + DB |
| Opportunity decision/readiness | `/api/opportunities/:id/decision`, decision panel UI |
| Experiment state transitions | Experiment rows, experiment page, agent task approval state |
| Metric ingestion + duplicates (409) | metric table + experiment page time-series |
| REAL_DATA provenance | `dataClass` + `source` + `recordedBy` on every metric row |
| Revenue calculations + provenance notes | `/growth` revenue intelligence card, `/api/growth/revenue` |
| Learning / reassessment / rerank | RankingSnapshot rows (append-only), opportunity learning panel |
| Errors, recovery recommendations, circuit breaker | operational events (Phase 14), failure classification, `/api/system/operations` |

**Never** logged: API keys, passwords, session tokens, connection strings. Credential/cookie/token
patterns are redacted before display by the Phase 14 event model.

## 5. Rollback / failure plan (truthful states on every failure)

| Failure | Immediate action | Resulting truthful state |
| --- | --- | --- |
| DB unavailable at deploy | Fix `DATABASE_URL`/network; redeploy | readiness 503 `unreachable`; app serves pages but no persistence |
| Migration fails mid-deploy | Do not start traffic; `prisma migrate deploy` is atomic per migration; re-run after fix | `migrationsApplied: false` on readiness; no partial schema claims |
| Provider unconfigured | Skip that provider (graceful degradation is designed) | `NOT_CONFIGURED` in health rows; research reports `CONFIG_ERROR` |
| Provider auth fails (401/403) | Re-issue credential, re-run health check | `AUTH_FAILED` persisted; executions `UNAVAILABLE`; no retry spend |
| Provider out of credits (402 — SambaNova history) | Billing action required on the provider account | `CREDIT_LIMITED`/`FAILED` persisted; non-retryable by design |
| Research run fails/empty | Inspect per-provider statuses in run result; fix; re-run | `FAILED`/`EMPTY` run persisted; **no evidence invented**; opportunity stays unvalidated |
| Evidence validation fails | Review contradictions/gaps surfaced in UI | conclusion `INSUFFICIENT_EVIDENCE`/`REQUIRES_HUMAN_REVIEW` — never auto-upgraded |
| Opportunity validation fails | Human review; optionally research again | Status unchanged; handoff remains blocked (422 with reasons, nothing persisted) |
| Experiment fails | Record truthfully; use ESTIMATED_DATA correction notes if needed; never overwrite history | append-only metric policy preserves the record |
| Metrics missing | Continue collecting; evaluation returns `INSUFFICIENT_DATA` | NOT_MEASURED end to end; learning blocks ranking impact below sufficiency threshold |
| Contradictory metrics | Human review (decision pipeline rule C/G) | `REVIEW_CONFLICT` / `HUMAN_REVIEW` — never silently resolved |
| Revenue data unavailable | Nothing to do — system already reports honestly | INSUFFICIENT_DATA provenance note on `/growth`; NOT_MEASURED totals |
| Autonomous gate blocks execution | That is the intended fail-closed behavior | `WAITING_APPROVAL`/`BLOCKED`; operator resolves; no bypass exists |

Rollback of the application itself = redeploy the previous known-good commit (all migrations are
additive and backward-compatible; no destructive migration exists in the set). Rollback of data =
restore from the provider's backup (operator responsibility, inventory item L1).
