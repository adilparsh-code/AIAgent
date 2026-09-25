# AI Income Lab — AIAgent (Phases 1–26)

Discover, validate, build, publish, measure, earn, and scale halal online income opportunities.

AIAgent is the **research / discovery / validation engine** for the larger AI Income system.
Its core question is: *"Is this opportunity supported by enough real evidence to justify implementation?"*

> **Important:** all dashboard numbers are **SAMPLE DATA / AI ESTIMATE** unless they were created by you
> and stored in PostgreSQL. Do not treat sample rows as market research, traffic, sales, or revenue.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma persistence
- Vitest for unit tests
- Vercel-compatible architecture: UI → API/Server → Repository → Prisma → PostgreSQL

Prisma is server-only. Client components never import `@prisma/client` or `DATABASE_URL`.

## Research architecture

```
Discovery topic/category
   → POST /api/discovery
   → Candidates generated (hypotheses only)
   → Each candidate researched through existing providers
   → Evidence normalized / validated / scored / ranked
   → Opportunity Brief
   → Optional AI Income Lab handoff contract (not executed)

Opportunity
   → "Run Research" (UI)
   → POST /api/research
   → Research providers execute (per-purpose queries)
   → Evidence collected, normalized, sanitized, deduplicated
   → Findings generated
   → Validation signals derived from evidence
   → Confidence calculated (quality + source diversity − contradiction penalty)
   → Evidence-driven conclusion
   → Research-informed score guidance (suggestion only)
   → Run persisted transactionally:
       ResearchRun + ResearchSource(s) + Evidence + ResearchFinding + Validation
       + opportunity research metadata — atomically, or not at all
   → Result displayed honestly in the UI
```

## Data model (PostgreSQL)

```
Opportunity 1─N ResearchRun 1─N ResearchQuery
                        1─N ResearchSource (one row per provider per run)
                        1─N Evidence N─1 ResearchSource  (which provider produced this evidence)
                        1─N ResearchFinding N─N Evidence (evidenceIds + FK link)
                        1─1 Validation   (per-signal statuses + evidence ids, coverage,
                                          diversity, contradictions, conclusion)
Opportunity 1─N Product 1─N RevenueEntry
Opportunity 1─N Experiment
Opportunity 1─N RevenueEntry
Agent 1─N AgentRun (task, status, input/output/metadata JSON — extensible)
DiscoveryRun 1─N DiscoveryCandidate (optional Opportunity + ResearchRun links)
```

Every research save is a single transaction: `Run + Sources + Evidence + Findings + Validation`
plus the opportunity's `lastResearchRunId / lastResearchAt / lastResearchConclusion / researchRunCount`
are committed together or not at all — a half-saved run can never masquerade as success.
Duplicate evidence per run is blocked by a `@@unique([researchRunId, hash])` constraint.
Deleting an opportunity cascades to all of its research data.
### Providers

| Provider | Status | Env var (server-only) | Notes |
| --- | --- | --- | --- |
| Brave Search | **REAL LIVE DATA** when configured | `BRAVE_SEARCH_API_KEY` | Web search results used for demand, commercial-intent, and competition queries. |
| Reddit | **REAL LIVE DATA** (no key required) | — | Public search JSON endpoint; used for pain-point signals. Rate limits can cause `FAILED` runs. |
| Google Trends | **REAL LIVE DATA** via **SerpApi** when configured | `SERPAPI_API_KEY` | Google offers no official Trends API. SerpApi's `google_trends` engine returns normalized 0–100 *relative* interest values (12-month window). Limitations: relative, not absolute volume; one normalized evidence item per query; third-party scraping service. |

Missing keys never produce fake data. An unconfigured provider appears as
`CONFIG_ERROR` ("provider unavailable/not configured") in the run result — research **never** pretends success.

### Evidence / validation model

Every evidence item carries: source, title, URL (sanitized http/https only), snippet (HTML-stripped),
collectedAt, relevance, quality, a content hash, `supports` (purposes), `contradicts`, and a `dataClass`
(`REAL_LIVE_DATA` / `SAMPLE_DATA` / `AI_ESTIMATE` / `UNAVAILABLE`).

Evidence is deduplicated across providers by normalized URL and content hash so repeated copies of the
same underlying source cannot inflate confidence or signal counts. Contradictions are **preserved**,
counted, and lower the run confidence; they are surfaced in the UI, never silently discarded.

Validation signals (demand, pain-point, commercial-intent, trend, competition) are derived only from
evidence with explicit rules:

- `SUPPORTED`: ≥ 3 evidence items, ≥ 2 distinct providers, average quality ≥ 0.50, no contradiction.
- `MIXED`: evidence exists but does not meet the SUPPORTED thresholds (or is contradicted).
- `INSUFFICIENT`: no evidence for that purpose.

Conclusions are evidence-driven, never inferred from research success:

| Conclusion | Rule |
| --- | --- |
| `VALIDATED` | ≥ 2 signals `SUPPORTED` and zero contradictions. |
| `PROMISING` | ≥ 1 signal `MIXED`, confidence ≥ 0.5, no contradictions. |
| `INSUFFICIENT_EVIDENCE` | No usable evidence, or no signal better than `MIXED` with low confidence. |
| `CONTRADICTED` | Signals would be supported but other evidence contradicts them. |
| `REQUIRES_HUMAN_REVIEW` | Supported signals coexist with contradictions, or confidence is below 0.5 with no supported signals. |
| `REJECTED` | Reserved for explicit human decision; automated research never assigns it. |

### Research → scoring integration

The existing weighted scoring engine (Demand 20%, Commercial Intent 20%, Competition Opportunity 15%,
Startup Cost 10%, Automation 10%, Differentiation 10%, Monetization Strength 10%, Halal/Compliance 5%)
is **unchanged**. Research adds a guidance layer that classifies each factor as
`research-supported`, `research-unsupported`, `insufficient-evidence`, `human-review-required`, or
`unchanged`, and only suggests an overall score when ≥ 2 factors are research-supported.
Scores are never fabricated from weak evidence; factors that cannot be derived from evidence are
marked as requiring review and left unchanged.

## Data classification (shown in the UI)

- **REAL LIVE DATA** — collected from a configured provider at run time.
- **SAMPLE DATA** — in-repo demo rows (`src/lib/data`), clearly labeled, never mixed with user rows.
- **AI ESTIMATE** — human/author-supplied judgments recorded in sample rows (e.g. sample scores).
- **UNAVAILABLE** — provider not configured or failed; shown honestly instead of inventing data.

## Environment variables

Server-side only — never use `NEXT_PUBLIC_*` for research secrets:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (server-only). Required for persistence. |
| `BRAVE_SEARCH_API_KEY` | Brave Search API key (optional; without it Brave reports CONFIG_ERROR). |
| `SERPAPI_API_KEY` | SerpApi key for Google Trends data (optional; without it Google Trends reports CONFIG_ERROR). |

Copy `.env.example` to `.env` and fill in your own values. Never commit `.env` or real credentials.

## Running locally

```bash
# Install dependencies and generate the Prisma client
npm install

# Copy the example env file and fill in your own values
cp .env.example .env

# Apply migrations
npx prisma migrate deploy

# Generate the client (also runs on npm install)
npx prisma generate

# Optional: seed clearly-labeled SAMPLE rows (never run in production by default)
npx prisma db seed

# Start the app
npm run dev
```

Open `http://localhost:3000`. Without `DATABASE_URL`, the UI still shows in-repo sample/demo data;
create/update/delete, live research, and agent-run persistence require PostgreSQL.

### Migrations and seed

- `npx prisma migrate deploy` — apply committed migrations (production-safe; used by CI).
- `npx prisma migrate dev` — create a new migration during development.
- `npx prisma db seed` — runs `prisma/seed.ts`, which inserts ONLY rows marked `isSample: true`
  with `SAMPLE DATA` in their titles/notes. It is opt-in and never runs automatically; sample
  rows are always distinguishable from real user data and are excluded from the app's real records.

A fresh database initializes with: `createdb` → `prisma migrate deploy` → (optionally) `prisma db seed`.

## Running tests and checks

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs the same checks against PostgreSQL 16,
including `prisma migrate deploy` so the migration set stays verified.

## How research works (user flow)

1. Open an opportunity → **Research** section → **Run Research**.
2. The UI calls `POST /api/research` with the opportunity id and title.
3. Providers execute; each provider's status (`SUCCEEDED` / `EMPTY` / `CONFIG_ERROR` / `FAILED` /
   `UNAVAILABLE`) is shown, including the exact error message.
4. The result shows providers attempted/succeeded, evidence with sources and data class, findings,
   validation signals with their evidence trace, contradictions, confidence, the conclusion with its
   explicit basis, and the research → scoring guidance.
5. Research run history (last 10 runs) is listed on the opportunity page; every run is persisted
   with its sources, evidence, findings, validation signals, and conclusion. Click a past run in the
   history list to inspect it — all data survives browser refresh and server restart.
6. Agent runs are persisted via `POST/GET /api/agents/[id]/runs` and viewable per agent on the
   Agents page. Phase 2 records runs for audit; no agent logic executes yet.

## Security notes

- API keys are read only in server code (`process.env`); nothing is exposed via `NEXT_PUBLIC_*`.
- All API input is validated and length-capped (title ≤ 240 chars, ids ≤ 64 chars, history limit ≤ 50).
- Provider content is HTML-stripped before storage/rendering; URLs must be http(s) — `javascript:` /
  `data:` URLs are dropped, and links render with `rel="noopener noreferrer nofollow"`.
- Errors never include credentials (verified by unit test for the Brave provider).
- `.gitignore` covers `.env` and `.env*.local`; no secrets are committed.

## Observability

Server-side structured logging (JSON lines) covers: `research.started`, `research.completed`,
`research.failed`, `database.error`, and `agentRun.started/completed/failed`. Only ids, statuses,
and error messages are logged — never secrets, API keys, or connection strings.

## Phase 1 status

Complete: research architecture (providers → evidence → findings → validation → conclusion),
provider abstraction with injection for tests, evidence normalization/dedup/contradiction handling,
evidence-driven validation signals and conclusions, research-informed scoring guidance, research run
history in UI + PostgreSQL, honest provider status reporting, SerpApi-based Google Trends provider,
expanded test suite, CI workflow, and documentation.

## Phase 2 status

Complete: first-class `ResearchSource`, `Validation`, and `AgentRun` models; evidence→source
traceability ("which provider produced this evidence?"); fully transactional research persistence
including opportunity research metadata; AgentRun API + per-agent run visibility in the UI; labeled
seed script (`prisma/seed.ts`, `npm run db:seed`); structured observability logging; persistence
tests running against real PostgreSQL (CI provides a Postgres 16 service); fresh-database init
verified; lint verified. Client components still never touch Prisma — UI → API → repository →
Prisma → PostgreSQL.

## Phase 4 — Autonomous opportunity engine

Pipeline: DISCOVER → RESEARCH → NORMALIZE EVIDENCE → VALIDATE → SCORE → RANK → OPPORTUNITY BRIEF → HANDOFF READY.

- Candidates are research hypotheses, never invented market facts.
- Every candidate is researched through the existing orchestrator (Brave, Reddit, Google Trends / SerpApi, plus any future provider).
- Missing provider data is never treated as positive evidence.
- Ranking separates evidence-backed signals, calculated scores, and AI estimates.
- AI Income Lab handoff is a machine-readable contract only — implementation is not executed here.

APIs:

- `POST /api/discovery` — start a discovery run (`topic`, `category`, optional `maxCandidates` ≤ 5)
- `GET /api/discovery` — list recent runs
- `GET /api/discovery/[id]` — run status and ranked candidates
- `GET /api/discovery/candidates/[id]` — validated opportunity brief
- `POST /api/discovery/candidates/[id]/handoff` — prepare the Income Lab handoff contract

UI: Discovery → Research → Validation → Score → Ranked Opportunities → Handoff Ready (`/discovery`).

## Phase 5 — AI Income Lab handoff + experiment engine

Pipeline: **Validated opportunity → handoff contract → accept/reject → experiment → metrics →
evaluate → WIN/ITERATE/STOP/INSUFFICIENT_DATA → feedback to AIAgent**.

- **Handoff contract** (`src/lib/handoff.ts`): versioned, machine-readable contract at the
  AIAgent → AI Income Lab boundary (opportunity, validation conclusion, confidence, score, evidence
  references, monetization options, risks, recommended experiment type, hypothesis, success
  criteria, budget/time limits, status).
- **Evidence gate**: an opportunity is `HANDOFF_READY` only when validation permits implementation
  (`VALIDATED` or `REQUIRES_HUMAN_REVIEW`), evidence/confidence/score exist, and risks are
  recorded. `REJECTED` opportunities and `NOT_ALLOWED` models never hand off. Ineligible requests
  return explicit reasons (422) and nothing is persisted.
- **Handoff API**: `GET/POST /api/handoffs`, `GET/POST /api/handoffs/:id` with
  `action: accept | reject | createExperiment`. Acceptance re-checks eligibility; experiment
  creation (status `READY`, no campaigns launch, no money moves) plus the `COMPLETED` handoff
  transition commit in one transaction.
- **Experiment engine**: Experiment rows now carry `objective`, `successCriteria`, `metrics` (JSON),
  `result`, `notes`, `feedback` and a `handoffId`. New statuses (`READY`, `RUNNING`, `STOPPED`,
  `ITERATING`) and decisions (`WIN`, `STOP`, `INSUFFICIENT_DATA`) extend — never replace — the
  legacy values.
- **Evaluation rules** (`src/lib/experiment-evaluation.ts`): conversion rate, profit and ROI are
  computed only where mathematically possible (zero cost ⇒ ROI undefined, not infinite). Decisions
  follow explicit documented thresholds (`DECISION_RULES`); missing data ⇒ `INSUFFICIENT_DATA`,
  never a fabricated verdict. Derived values are labeled `ESTIMATED_DATA`; recorded metrics are
  `REAL_DATA`. Missing metrics stay missing.
- **Feedback loop**: `POST /api/experiments/:id/evaluate` computes the decision, persists result +
  decision + feedback, and returns a structured feedback object (actual metrics/revenue/cost/profit,
  decision, lessons, evidence generated, recommendation for future research) usable by the research
  layer.
- **UI**: new **Handoffs** section (create → accept/reject → create experiment → inspect contract
  JSON), a "Create Handoff" action on opportunity pages, and an "Evaluate Result" action plus
  metrics/result/feedback panels on experiment pages.
- **Security**: all handoff/experiment API inputs are validated and size-capped (ids ≤ 64 chars,
  text ≤ 600 chars, budgets ≤ 1,000,000, metrics limited to known numeric keys); decisions cannot
  be re-taken on finished handoffs (409); sample rows stay immutable.

## Phase 6A — Authentication + multi-tenancy

Every user's data is private. The full Phase 1–5 pipeline (discover → research → validate → score →
handoff → experiment → evaluate → feedback) is unchanged — it is now owned per user.

- **Accounts**: email + password (scrypt-hashed via node:crypto, N=16384/r=8/p=1; plaintext is never
  persisted or logged; hashes never leave the server). `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`. Login/registration failures are generic (no account
  enumeration) and rate-limited (10 login attempts / 15 min per IP+email; 10 registrations / hour per IP).
- **Sessions**: server-side `Session` rows keyed by the SHA-256 hash of an opaque 256-bit token;
  the browser only receives an HttpOnly, SameSite=Lax cookie (Secure in production) with a 7-day
  expiry. Logout deletes the server row. No tokens in localStorage, no secrets in client bundles.
- **Ownership model**: ownership follows the data tree. `Opportunity`, `Product`, `RevenueEntry`,
  `DiscoveryRun` (direct `ownerId`), and `AgentRun` (who created it) are roots; `ResearchRun`,
  `ResearchSource`, `Evidence`, `Findings`, `Validation`, `Handoff`, and `Experiment` are reached
  through their Opportunity, so no ownership data is duplicated.
- **Authorization**: reusable helpers (`requireUser`, `requireAdmin`, `requireOwnedResource`) run in
  every protected route before any data access. Identity comes only from the session cookie — client
  ids/headers/bodies can never influence it. A record that belongs to someone else answers **404**
  (indistinguishable from a missing row) so cross-tenant probing learns nothing. Unowned legacy/sample
  rows are visible only to pinned sample surfaces, not to arbitrary users. Mutating the shared agent
  catalog is admin-only; `ADMIN` gets no blanket access to other users' private records.
- **Pages**: `/login` and `/register`; unauthenticated deep links redirect to `/login?returnTo=…` via
  middleware (middleware is a UX gate — every API re-verifies server-side). The shell shows the signed-in
  identity with a logout button.
- **Migration**: `20260923120000_phase6a_auth_multitenancy` is purely additive — creates `User`,
  `Session`, ownership columns and indexes. Existing Phase 1–5 rows keep working (owners are NULL
  until explicitly reassigned); nothing is reset or rewritten.

## Phase 6B — Time-series experiment metrics

`Experiment.metrics` JSON was a single snapshot. Phase 6B adds a persistent, auditable time series
without removing anything:

- **`ExperimentMetric`** rows (`20260923130000_phase6b_metric_time_series`, purely additive): one row
  per raw measurement over a reporting period (day/week/arbitrary window) with `recordedAt`,
  `periodStart`/`periodEnd`, optional raw values (`impressions`, `clicks`, `visits`, `leads`,
  `conversions`, `revenue`, `cost`), `currency`, `source`, `dataClass` (`REAL_DATA`/`ESTIMATED_DATA`),
  `notes`, and `recordedBy` (the session user — who/what/when/where audit trail). Unique on
  `(experimentId, periodStart, periodEnd, source)`: accidental duplicate ingestion is rejected (409),
  while multiple legitimate sources measuring the same period are all preserved. Indexed on
  `experimentId`, `(experimentId, recordedAt)`, and `periodStart`; cascade-deletes with the experiment.
- **Raw vs derived**: only raw measurements are persisted. CTR, conversion rate, profit, ROI, CPC,
  CPL, CPA, and revenue-per-visit are always calculated from recorded rows and labeled as calculated.
- **Missing-data semantics**: an unrecorded metric is NULL end to end (DB → repository → API →
  aggregation → evaluation → UI, rendered as “—”), never coerced to zero; explicit zeros stay zeros.
  Zero denominators yield null derived values — never NaN or Infinity.
- **Aggregation**: `summarizeMetricSeries` produces chronological totals, cumulative running totals,
  per-record data classes (`REAL_DATA`/`ESTIMATED_DATA`/`MIXED`), and the missing-key list. Date-range
  filtering uses inclusive overlap semantics (`periodEnd ≥ from AND periodStart ≤ to`).
- **APIs** (all owner-authorized through Experiment → Opportunity, same 404-masking as Phase 6A):
  `POST/GET /api/experiments/:id/metrics`, `GET /api/experiments/:id/metrics/summary?from&to`.
- **Evaluation**: `POST/GET /api/experiments/:id/evaluate` now prefers the aggregated time series and
  falls back to the legacy `metrics` JSON snapshot when no metric records exist, so pre-6B experiments
  evaluate unchanged. Decision rules are the untouched Phase 5 rules; feedback records flag
  estimated/mixed series.
- **Mutation policy**: append-only. Corrections are new records (optionally `ESTIMATED_DATA` with a
  note); the owner can explicitly delete a record, but nothing is silently rewritten.
- **UI**: the experiment page gained a time-series table (period, raw values, class, source), a
  summary card distinguishing recorded vs calculated vs missing, a relative conversions bar built from
  recorded data only, and an append-metric form.

## Phase 6C — Experiment feedback → learning + re-ranking

Real experiment outcomes now feed back into opportunity ranking — through transparent, deterministic
rules, never AI score magic:

- **Feedback contract** (`src/lib/experiment-learning.ts`, `feedbackVersion: 2`, persisted under each
  experiment's Phase 5 `feedback.learning`): records the measurement period, recorded totals (raw),
  calculated derived metrics, sufficiency assessment, learning signals, data class
  (`REAL_DATA`/`ESTIMATED_DATA` — estimated data never receives the weight of real data), decision,
  research implications, and bounded ranking impact.
- **Learning signals** derive only from recorded evidence via explicit rules: demand (sufficient
  observations with conversions/traffic), conversion (conversion rate vs `DECISION_RULES`),
  monetization (recorded revenue), unit economics (profit/ROI), plus
  `INSUFFICIENT_EXPERIMENT_DATA`. No signal is generated merely because a field exists.
- **Sufficiency gate** (`SUFFICIENCY_THRESHOLDS`): INSUFFICIENT / LOW_SIGNAL / MEANINGFUL_SIGNAL /
  STRONG_SIGNAL from record count, observations, conversions, revenue, and estimated-record share.
  Below `MEANINGFUL_SIGNAL` an experiment **cannot move the ranking** — one tiny experiment can
  never dominate. All thresholds are documented constants, not scattered magic numbers.
- **Multi-experiment aggregation**: all of an opportunity's experiments are aggregated (never just
  the latest) with explicit conflict handling — `MIXED_EXPERIMENT_EVIDENCE` when directions disagree,
  `EXPERIMENT_CONTRADICTS_RESEARCH` when recorded results contradict the research conclusion.
- **Ranking formula** (extends, never replaces, the Phase 1 weighted research score):
  `effective score = clamp(research overallScore + bounded experiment delta, 0–100)` where the delta
  is capped at **±10** (`MAX_EXPERIMENT_SCORE_IMPACT`, justified in-code and test-asserted).
  `overallScore` itself is never mutated; the delta is stored separately, so reranks are idempotent.
- **Validation context** classifies `RESEARCH_SUPPORTED` / `EXPERIMENT_SUPPORTED` / `BOTH_SUPPORTED`
  / `MIXED_EVIDENCE` / `INSUFFICIENT` — an experiment never flips research validation by itself.
- **Confidence** stays separate from score and combines research confidence with an experiment
  confidence that grows with sufficiency and consistency and shrinks with contradictions.
- **Deterministic re-ranking** (`rerankOpportunities`): batched queries (3 per run — no N+1),
  sorted deterministically, every entry carries an explanation naming the signals and experiments
  behind any change. `POST /api/opportunities/:id/rerank` is manual and owner-scoped; nothing runs
  automatically and no external actions are triggered.
- **Audit trail**: every rerank persists append-only `RankingSnapshot` rows (previous/new score and
  rank, delta, validation context, confidence, reason, contributing signals, experiment ids); the
  opportunity keeps `lastRankingSnapshotId` + `lastRankingAt`.
- **APIs** (all authenticated, owner-scoped, Phase 6A 404-masking): `POST
  /api/experiments/:id/feedback`, `GET /api/opportunities/:id/feedback`, `GET
  /api/opportunities/:id/ranking`, `POST /api/opportunities/:id/rerank`. Client-supplied scores are
  never accepted — the server computes everything.
- **UI**: the opportunity page gained a learning/evidence panel (research evidence, experiment
  evidence, learning signals, contradictions, ranking change, reason) with a manual rerank button.
- **Migration**: `20260923140000_phase6c_learning_reranking` — additive (`RankingSnapshot` table,
  ranking columns on `Opportunity`); no resets, no history rewritten.

## Phase 6B — Session hardening and account session management

Phase 6A authentication is extended with user-visible session management without changing the authentication token model.

- **Session inventory:** `GET /api/auth/sessions` lists only the authenticated user's unexpired sessions with safe metadata (created, last-used, expiry, and current-session marker). Raw tokens and token hashes are never returned.
- **Selective revocation:** `DELETE /api/auth/sessions` with a `sessionId` revokes that session only when it belongs to the authenticated user. Cross-user ids resolve to 404.
- **Sign out everywhere else:** `DELETE /api/auth/sessions` with `{ "all": true }` revokes every other session while preserving the current session. Existing `/api/auth/logout` remains the operation for ending the current session.
- **Server-side ownership:** session revocation is enforced by `userId + sessionId` in the database; client-supplied user ids are never accepted.
- **Security:** session tokens and hashes never appear in API responses, localStorage, query strings, client bundles, or logs.
- **Tests:** route-level tests cover authentication, safe metadata, single-session revocation, current-session protection, revoke-all semantics, cross-user isolation, and mock isolation.

## Phase 8 — Real-world integrations + execution adapters

A provider-agnostic integration framework connects AIAgent to external services through safe,
auditable adapters — incrementally, and without pretending any connection exists before one does:

- **Integration contract** (`src/lib/integrations/contract.ts`): types (AI_PROVIDER, RESEARCH,
  SOCIAL, CONTENT, AFFILIATE, MARKETPLACE, ANALYTICS, EMAIL, STORAGE, PAYMENT), statuses
  (NOT_CONFIGURED / CONFIGURED / HEALTHY / DEGRADED / AUTH_FAILED / FAILED / DISABLED), capabilities
  (READ_DATA, SEARCH, CREATE_DRAFT, UPLOAD, PUBLISH, SEND_MESSAGE, CREATE_CAMPAIGN, SPEND_MONEY),
  a common `ExecutionResult` shape, HTTP error classification, credential redaction, and an
  untrusted-content wrapper for prompt-injection defense.
- **Adapters actually implemented** (real probes, real executions):
  - `sambanova` (AI_PROVIDER) — OpenAI-compatible chat completions over plain fetch; health check
    performs a real 1-token authenticated completion. Without `SAMBANOVA_API_KEY` it reports
    `NOT_CONFIGURED` and `execute()` returns `UNAVAILABLE` — output is never fabricated. Usage
    metadata is echoed only when the provider returns it; estimated cost is never invented.
  - `brave-search` (RESEARCH) — real `GET /res/v1/web/search?q=test&count=1` health probe;
    `SEARCH_WEB` action. 401/403 → AUTH_FAILED, 429 → DEGRADED.
  - `reddit` (RESEARCH) — public search endpoint (no key); `SEARCH_POSTS` action.
  - `google-trends` (RESEARCH) — SerpApi `engine=google_trends` probe; `SEARCH_TRENDS` action.
  The Phase 1 evidence architecture remains the only path that produces research Evidence;
  these adapters add health/status visibility without touching the orchestrator.
- **Scaffolded integrations** (registry entries exist; honestly inert until real API code is
  written): `pinterest`, `youtube`, `affiliate-network`, `marketplace`, `analytics-platform`.
  Even with env vars present they never claim more than CONFIGURED, and `execute()` returns
  BLOCKED ("not implemented") — never a fake success. PUBLISH/SEND/SPEND capabilities are
  intentionally NOT granted to scaffolds.
- **Capability permissions**: task-type → action → adapter → capability is enforced server-side
  (`permissions.ts`). PUBLISH / SEND_MESSAGE / CREATE_CAMPAIGN / SPEND_MONEY always require
  explicit owner approval (no SAFE_AUTOMATED bypass in Phase 8); READ_DATA/SEARCH run tenant-scoped
  without approval. Current mappings carry only safe capabilities.
- **Execution bridge**: AgentTask → permission decision → approval gate (`WAITING_APPROVAL`)
  → bounded retries (retryable classes only: SERVER/NETWORK/RATE_LIMIT) → adapter → audited
  result. Idempotency: an already-succeeded (adapter, action, task) combination is skipped;
  duplicate metric ingestion fails safe (original measurement preserved).
- **Metrics ingestion**: measurable provider output maps into the Phase 6B `ExperimentMetric`
  table as `REAL_DATA` with `source = adapter-name`; missing metrics stay NULL (never zero),
  duplicates are rejected by the existing unique constraint, and history is never overwritten.
- **Secrets**: resolved server-side only (`process.env`); never stored in Prisma models,
  localStorage, URLs, logs, or API responses. Only env var NAMES and presence are exposed.
  Error messages and audit rows are redacted (`sanitizeErrorMessage`).
- **Persistence** (`20260923160000_phase8_integration_framework`, additive):
  `IntegrationHealth` (last real check per adapter, upserted) and `IntegrationExecution`
  (append-only audit: who/what/when/duration/sanitized error).
- **APIs** (all authenticated): `GET /api/integrations`, `GET /api/integrations/:id`,
  `POST /api/integrations/:id/health` (runs a real check and persists it),
  `GET /api/integrations/:id/executions` (owner-scoped).
- **UI**: `/integrations` dashboard with status dots, capabilities, missing env var names, and
  per-integration health-check buttons; detail view with configuration guidance (names only),
  last check/error, and recent executions. Env docs: see the table below.

### Integration environment variables (server-side only; names in `.env.example`)

| Provider | Variable | Purpose | Health-check behavior | Type |
| --- | --- | --- | --- | --- |
| Brave Search | `BRAVE_SEARCH_API_KEY` | Web search research | Real search API probe; READ/SEARCH, no approval needed | RESEARCH (live adapter) |
| SerpApi (Google Trends) | `SERPAPI_API_KEY` | Trends signals | Real engine probe; READ/SEARCH, no approval needed | RESEARCH (live adapter) |
| Reddit | — (public) | Community/pain-point signals | Real public-endpoint probe | RESEARCH (live adapter) |
| SambaNova | `SAMBANOVA_API_KEY` (+ optional `SAMBANOVA_MODEL`, `SAMBANOVA_BASE_URL`, `AI_PROVIDER_ENV`) | LLM drafts/analysis for agent tasks | Real 1-token authenticated completion; CREATE_DRAFT only | AI_PROVIDER (live adapter) |
| Pinterest / YouTube / affiliate / marketplace / analytics | see `.env.example` comments | Future publishing/reporting integrations | Scaffold only: reports NOT_CONFIGURED/CONFIGURED, executes nothing | scaffold |

`AI_PROVIDER_ENV` / `RESEARCH_PROVIDER_ENV` label the provider environment as TEST or LIVE so test
configuration is always distinguishable from production.

## Phase 9A — API-independent live execution foundation

A provider-independent execution orchestration layer sits between the Phase 7 AgentTask runtime and
the Phase 8 integration adapters. External API credentials are NOT required for any of it — the
same gates, state machine, idempotency and audit run identically once real providers are plugged in.

- **Execution contract** (`src/lib/execution-contract.ts`, `EXECUTION_CONTRACT_VERSION = 1`):
  statuses `QUEUED / RUNNING / SUCCEEDED / FAILED / TIMEOUT / RATE_LIMITED / AUTH_FAILED /
  UNAVAILABLE / BLOCKED / CANCELLED` (`SUCCEEDED` never marks an execution that did not actually
  run); a deterministic state machine (only `FAILED/TIMEOUT/RATE_LIMITED → RUNNING` may go back —
  terminal states have no outgoing edges); bounded retry policy (`maxAttempts` clamped 1–5, only
  `SERVER/NETWORK/RATE_LIMIT` error classes are retryable, and `PUBLISH / SEND_MESSAGE /
  CREATE_CAMPAIGN / SPEND_MONEY / UPLOAD` capabilities are NEVER auto-retried); and DRY_RUN
  labeling (`dataClass = SAMPLE_DATA`, never `REAL_DATA`).
- **Persistence** (`20260923200000_phase9a_agent_executions`, purely additive): the `AgentExecution`
  table records task, owner (denormalized opportunity/experiment ids for audit), integration,
  action, capability, approval status, mode (`LIVE`/`DRY_RUN`), status, `retryCount`/`maxAttempts`,
  timing, sanitized result and error, and the recorded `dataClass`. `idempotencyKey` is UNIQUE —
  duplicate requests resolve to the existing row (including concurrent duplicates, which surface as
  `P2002` and are absorbed) instead of creating duplicate executions.
- **Orchestrator** (`src/lib/server/execution-orchestrator.ts`): the only writer of execution
  rows. Pipeline: AgentTask → ownership → status gate → Phase 8 permission decision → approval
  gate → integration resolution/config → execution → result → persistence → Phase 8 audit row →
  metrics ingestion. Actions come only from the Phase 8 allowlist (`TASK_TYPE_ACTIONS`) — never
  from task inputs; external content in inputs is wrapped as untrusted data before it can reach a
  prompt. Approval-requiring capabilities set the task to `WAITING_APPROVAL` and create no
  execution row. Adapters resolve through the existing registry (dependency injection: a real
  provider plugs in without orchestrator changes).
- **DRY_RUN / simulation mode**: `POST` with `{ "mode": "DRY_RUN" }` runs every gate (auth,
  ownership, task status, permission, approval, integration resolution) and reports what a LIVE
  execution would do — but never calls a provider. Rows are `mode=DRY_RUN`, `dryRun=true`,
  `dataClass=SAMPLE_DATA`; the UI/API wording is always "simulation only, no real execution".
- **Honest unavailability**: with no credentials configured, a LIVE execution of a Brave task ends
  `UNAVAILABLE` with a classified, sanitized error on the row — never a fabricated success.
- **APIs** (authenticated, owner-scoped, 404-masked like Phase 6A): `POST
  /api/agent-tasks/:id/executions` (body `{"mode":"LIVE"|"DRY_RUN"}`, default LIVE) and `GET
  /api/agent-tasks/:id/executions` (task execution history, optional `status` filter). Task-level
  completion/failure is mirrored onto the AgentTask row as before.
- **Tests**: pure state-machine/retry/idempotency unit tests plus real-PostgreSQL integration
  tests covering concurrent duplicate idempotency, illegal-transition rejection, terminal-state
  handling (including `UNAVAILABLE` not being re-run), bounded retry, dry-run honesty, approval
  gates creating no execution rows, owner scoping, and secret-free persistence.

## Phase 9 — Live execution + AI Income Lab execution bridge

Phase 9 turns the integration framework into **one real, safe, measurable
execution path** end to end. It is provider-agnostic and works today without
credentials; the moment a provider is configured the same path runs it live.

**Vertical slice**

```
Integrations UI → Run test execution (fixed deterministic objective)
  → AgentTask (budget 0, 1 attempt, 1 action, 60s)
  → allowlisted action → capability/approval gates
  → real provider API call
  → AgentExecution (Phase 9A state machine + unique idempotency key)
  → IntegrationExecution audit row (Phase 8)
  → AgentArtifact (data-class labelled)
  → ExperimentMetric ONLY when the provider returned real measurements
  → evaluation + learning feedback → optional manual rerank
```

**What was added**

- `src/lib/integrations/test-execution.ts` — the pure catalog: which allowlisted
  actions a provider exposes (`resolveTestActions`), the fixed deterministic
  objective for each action, strict limits, and request-id validation.
  Approval-class (`PUBLISH / SEND_MESSAGE / CREATE_CAMPAIGN / SPEND_MONEY`) and
  irreversible (`UPLOAD`) capabilities are **never** testable.
- `src/lib/server/test-execution-service.ts` — one safe, bounded, owner-scoped
  provider call per request, run through the Phase 9A orchestrator so the whole
  audit trail exists. Duplicate `requestId`s resolve to the same execution.
- `POST /api/integrations/:id/test-execution` and `GET` (the safe action
  catalog). `POST /api/handoffs/:id/execute` — the AI Income Lab bridge from an
  accepted handoff to a safe execution plus truthful evaluation.
- Orchestrator extensions: explicit (still allowlisted) action selection,
  search-shaped payloads for `SEARCH_*` actions, and artifact creation on
  success with the provider's own data class.
- Control center: "Run test execution" on every live provider, a safe-action
  picker, result panel (status, data class, latency, sanitized error, execution
  id, artifact id), and REAL DATA / AI GENERATED / ESTIMATED DATA / SAMPLE-DRY
  RUN labels in the execution history.
- Tests: 21 new (catalog safety, missing key, 401, 429, 5xx, timeout, malformed
  response, duplicate suppression, cross-tenant blocking, prompt-injection
  boundary, secret non-disclosure) with the provider transport stubbed — no
  test ever contacts a real provider.

**Current live status (honest)**

No provider has credentials in this environment, so no real execution has
succeeded yet and Phase 9 is **not** declared complete. Real health checks at
the time of writing:

| Provider | Configured | Health check |
| --- | --- | --- |
| `sambanova` | no — missing `SAMBANOVA_API_KEY` | `NOT_CONFIGURED` |
| `brave-search` | no — missing `BRAVE_SEARCH_API_KEY` | `NOT_CONFIGURED` |
| `google-trends` | no — missing `SERPAPI_API_KEY` | `NOT_CONFIGURED` |
| `reddit` | yes (no key needed) | `AUTH_FAILED` — public endpoint returns HTTP 403 to this host's IP |
| scaffolds | no | `NOT_CONFIGURED` (never `HEALTHY`, never a fake success) |

See `docs/integrations.md` (operations) and `docs/environment.md` (every
server-side variable).

## Phase 10 — Opportunity Decision Readiness engine

The Opportunity Readiness engine answers, from **persisted application data
only**: what do we know, what evidence is missing, is the opportunity
research-ready / validation-ready / handoff-ready / blocked, what is the
safest next action, is the research stale, do experiments provide enough REAL
data to affect the decision, and are there contradictions requiring a human.

**This engine does not create market evidence. It interprets persisted
application evidence.**

- No external API, no API keys, no network calls, no fabricated data. The
  pure core lives in `src/lib/opportunity-readiness.ts` and every conclusion
  cites the persisted signal it is derived from (`explanation[]`).
- Readiness states (deterministic, first decisive rule wins):
  `RESEARCH_REQUIRED`, `RESEARCH_IN_PROGRESS`, `EVIDENCE_INSUFFICIENT`,
  `VALIDATION_REQUIRED`, `VALIDATION_CONFLICTED`, `EXPERIMENT_REQUIRED`,
  `EXPERIMENT_INSUFFICIENT`, `HANDOFF_READY`, `HUMAN_REVIEW_REQUIRED`,
  `READY_FOR_EXECUTION`, `BLOCKED`.
- Freshness policy: `DEFAULT_RESEARCH_FRESHNESS_DAYS = 30` (configurable in
  `READINESS_POLICY` / per call). `calculateResearchFreshness()` returns
  `NO_RESEARCH` vs `STALE_RESEARCH` vs `CURRENT_RESEARCH`. Stale research
  **only** means stored research is older than the configured threshold — it
  never claims demand changed or disappeared, and existing research is never
  rewritten or deleted.
- Evidence gaps come from the persisted `Validation` signals (demand, pain
  point, commercial intent, trend, competition), `sourceDiversity`, and
  `contradictionCount`, emitted as machine-readable areas: `DEMAND`,
  `PAIN_POINT`, `COMMERCIAL_INTENT`, `TREND`, `COMPETITION`,
  `SOURCE_DIVERSITY`, `CONTRADICTION_RESOLUTION`, `EXPERIMENT_DATA`.
- Experiment data-class rules: only `REAL_DATA` `ExperimentMetric` rows count
  as real-world evidence (minimum `MIN_REAL_METRIC_PERIODS = 2` periods).
  `ESTIMATED_DATA` rows are reported as `ESTIMATED_DATA` and are **never**
  treated as validated real-world performance. A completed experiment whose
  REAL_DATA outcome contradicts the research-supported commercial intent
  forces `HUMAN_REVIEW_REQUIRED`.
- Existing opportunity scores are never overridden: the engine emits a
  separate `readinessScore` (decision readiness, not quality).
- API: `GET /api/opportunities/:id/readiness` (`requireUser()`, owner-scoped,
  foreign and sample opportunities return an indistinguishable 404; no
  secrets; no external calls). The server service uses bounded queries (10
  runs, 20 experiments, 60 metric periods each) — no unbounded loads and no
  schema changes (readiness is computed on request, nothing cached).
- UI: `src/components/OpportunityReadiness.tsx` on the opportunity detail
  page (next to Research / Research intelligence / Opportunity learning),
  showing state, confidence, freshness, evidence gaps, contradictions,
  experiment status, handoff readiness, and the grounded next action. Missing
  data is stated explicitly; there are no fake progress bars.
- Limitations: readiness reflects only what the application has persisted —
  it cannot discover new evidence, and a stale/absent run simply means the
  stored data is old or missing, nothing more.

## Phase 11 — Opportunity decision pipeline + next action

The decision layer turns research intelligence, readiness, validation, experiment learning, and
handoff/execution state into ONE deterministic operational answer: **what is the safest next step?**
It is advisory orchestration logic — not a profitability prediction. It never claims an opportunity
will make money, never overrides existing scores, and never performs an external side effect.

```
Research → Research Intelligence → Readiness → Decision → Next Action
  → Validation / Experiment → Learning → Handoff → Execution
```

- **Decision engine** (`src/lib/opportunity-decision.ts`): composes the Phase 10 readiness engine
  (never re-derives its rules) with persisted execution state (AgentTask WAITING_APPROVAL / BLOCKED /
  RUNNING / COMPLETED) and handoff status. First decisive rule wins:

  | Rule | Condition (persisted only) | Decision |
  | --- | --- | --- |
  | K | status REJECTED or halalStatus NOT_ALLOWED | `BLOCKED` |
  | C/G | unresolved contradictions (validation signals or experiment REAL_DATA vs research) | `REVIEW_CONFLICT` |
  | J | AgentTask BLOCKED or WAITING_APPROVAL | `HUMAN_REVIEW` |
  | A | no completed research | `RESEARCH_MORE` |
  | D | stale research (freshness threshold) | `VALIDATE` (+ refresh action) |
  | B | evidence gaps from persisted validation | `RESEARCH_MORE` |
  | D2 | research adequate, validation missing | `VALIDATE` |
  | E/F | no experiment, or insufficient REAL_DATA / estimated-only | `RUN_EXPERIMENT` |
  | H | all gates satisfied, handoff missing/unaccepted | `HANDOFF_READY` |
  | I | handoff ACCEPTED/COMPLETED | `EXECUTION_READY` |

  SAMPLE / ESTIMATED / SIMULATED metric data is NEVER treated as REAL_DATA (ignored entirely),
  mirroring the readiness engine's honesty rules.
- **Next action** (`src/lib/opportunity-next-action.ts`): exactly ONE recommended action per
  decision, always citing the persisted state it resolves (`basis`). No LLM, no external API.
- **Research cycle** (`src/lib/research-cycle.ts`): the reusable lifecycle
  `DISCOVER → COLLECT → NORMALIZE → VALIDATE → CORRELATE → ASSESS → UPDATE INTELLIGENCE →
  REASSESS READINESS`, positioned per run from persisted data. Future live providers plug in at
  COLLECT (`STAGE_OWNERS` documents the owner of every stage); the decision architecture above it
  does not change. No fake external research is implemented.
- **Lifecycle** (`src/lib/opportunity-lifecycle.ts`): an advisory read-model derived from the same
  persisted inputs as the decision (forward path DISCOVERED → … → LEARNED plus BLOCKED /
  HUMAN_REVIEW / RESEARCH_CONFLICT / VALIDATION_CONFLICT / EXPERIMENT_INSUFFICIENT). The existing
  `Opportunity.status` field remains the system of record and is never written by these modules.
- **API**: `GET /api/opportunities/:id/decision` (`requireUser()`, owner-scoped, foreign and sample
  opportunities return an indistinguishable 404, bounded queries, no external calls, deterministic
  response, no sample leakage).
- **UI**: `src/components/OpportunityDecisionPanel.tsx` on the opportunity detail page next to
  readiness/research intelligence/learning: decision, confidence, readiness, lifecycle, blockers,
  the four gap groups, the explanation trail, and the prominent NEXT ACTION. No fake progress
  percentages, no marketing language, no revenue claims beyond persisted data.
- **Security**: the decision engine is pure and advisory — it can neither publish, send, spend, nor
  execute. Execution still runs exclusively through the Phase 7/9 approval + capability gates.

## Phase 12 — Opportunity portfolio intelligence + experiment prioritization

The portfolio layer evaluates the CURRENT portfolio of opportunities collectively and answers: "given
the opportunities and their current evidence, readiness, decision, experiment, handoff and execution
states, what should the system process next?" It is **not a profitability prediction system** and
never labels an opportunity best / worst / winner / loser / most profitable.

```
Individual Opportunity → Readiness → Decision
  → Portfolio Aggregation → Operational Queue → Experiment Prioritization
  → Learning → Handoff → Execution
```

- **Portfolio module** (`src/lib/opportunity-portfolio.ts`): pure and deterministic. It consumes the
  EXISTING read-model outputs (readiness engine + decision engine + persisted experiment/handoff
  facts) and only aggregates and buckets them — it introduces **no second persisted status system**
  and re-derives no individual decision.
- **Operational queues** (deterministic projection of the existing decision read-model):
  `RESEARCH_QUEUE`, `VALIDATION_QUEUE`, `EXPERIMENT_QUEUE`, `LEARNING_QUEUE`, `HANDOFF_QUEUE`,
  `EXECUTION_QUEUE`, `HUMAN_REVIEW_QUEUE`, `BLOCKED_QUEUE`, `MONITOR_QUEUE`.
- **Portfolio decision** (first decisive rule wins, derived only from persisted opportunity
  decisions): `FILL_RESEARCH_GAPS` → `VALIDATE_OPPORTUNITIES` → `RUN_EXPERIMENTS` →
  `IMPROVE_EXPERIMENTS` → `REVIEW_CONFLICTS` → `COMPLETE_HANDOFFS` → `EXECUTE_APPROVED_WORK` →
  `HUMAN_REVIEW_REQUIRED` → `MONITOR`. Exactly one portfolio-level action is surfaced.
- **Experiment prioritization** (`src/lib/experiment-prioritization.ts`): an explicit, weighted,
  explainable operational attention score. Every factor reports the value it read, the weight
  applied, the contribution, and the persisted basis: decision readiness (20), evidence
  completeness (15), REAL_DATA coverage (20), experiment availability (10), research freshness
  (10), learning signal (10), experiment freshness (10), approval flow (5); penalties for
  contradictions (25), execution blockers (15), pending approval (10), stale research (10), and
  insufficient REAL_DATA (10). Missing inputs score 0 and say so — values are never invented.
- **Data-class rules** (never relaxed): only `REAL_DATA` `ExperimentMetric` periods contribute to
  sufficiency. `SAMPLE_DATA`, `ESTIMATED_DATA`, and unparseable/unknown classes are never promoted
  to `REAL_DATA`; estimated periods are reported as present-but-excluded. Nothing here invents
  demand, revenue, conversion, market size, profitability, or user counts.
- **Concentration warnings** (operational only, no financial diversification claims): research /
  validation / approval backlogs, conflict clusters, opportunities sharing the same open evidence
  gap, experiments lacking REAL_DATA, a stale-research cluster, and multiple opportunities whose
  latest research run FAILED (a possible shared provider issue).
- **API**: `GET /api/opportunities/portfolio` (`requireUser()`, owner-scoped; only the caller's own
  non-sample opportunities are read, so there is no cross-user opportunity/research/experiment
  leakage; bounded reads with a constant query count; no external calls; no secrets; deterministic).
- **UI**: `src/components/OpportunityPortfolioPanel.tsx` on `/opportunities` — summary counts, the
  single current portfolio action, operational queues, neutral-labelled opportunities requiring
  attention, concentration warnings, and data quality (REAL_DATA coverage, non-real data
  limitations, stale research count). No guaranteed income, profit predictions, or investment-style
  ranking.
- **Security**: portfolio intelligence is advisory. It cannot publish, send, spend, or execute;
  execution remains exclusively behind the existing approval + capability gates.
- **Performance**: `src/lib/server/opportunity-decision-loader.ts` loads up to 50 opportunities with
  4 constant-count queries (no N+1) and is shared by both the per-opportunity decision service and
  the portfolio service, so the row → read-model mapping exists in exactly one place.
- **API-independent operation**: everything is computed from existing PostgreSQL/Prisma data. No
  Brave, Tavily, SerpAPI, SambaNova, OpenAI, Reddit, or Google Trends access is required. Future
  live providers plug into the research cycle's `COLLECT` stage without changing the portfolio,
  decision, or prioritization architecture.

## Phase 13 — Autonomous Operating Loop

The operating loop composes the existing portfolio intelligence, opportunity
 decisions, readiness, experiment prioritization, lifecycle, handoff, and
execution-gate read-models into one deterministic operating-cycle plan.

```text
Portfolio
↓
Selection
↓
Decision
↓
Next Action
↓
Research / Validation / Experiment
↓
Learning
↓
Handoff
↓
Execution Eligibility
↓
Measurement
↓
Reassessment
↓
Portfolio
```

The loop selects one opportunity for the next operational action using the
existing deterministic operational recommendation. It does not use a financial
ranking, profitability prediction, or invented measurement. Persisted
`Opportunity.status` remains authoritative; no second persisted state machine is
introduced. `SAMPLE_DATA` and `ESTIMATED_DATA` remain excluded from REAL_DATA
eligibility, and reassessment uses only existing experiment metrics and
learning decisions.

Safety gates are reported, not bypassed: authenticated owner context,
opportunity ownership, decision state, readiness, handoff acceptance, task
approval, execution permissions, required capability, and data-class
requirements must all pass before `executionEligible` can be true. The existing
approval and capability enforcement remains authoritative.

- **Core planner**: `src/lib/autonomous-operating-loop.ts` (pure, deterministic)
- **Service**: `src/lib/server/autonomous-operating-loop-service.ts` (owner-scoped, bounded)
- **API**: `GET /api/opportunities/operating-loop` (authentication required)
- **UI**: `src/components/AutonomousOperatingLoopPanel.tsx` on `/opportunities`
- **Bounds**: the shared decision loader reads at most 50 opportunities, 200
  research runs, 100 experiments, 60 metrics per experiment, and 200 tasks using
  a constant number of batched queries. There is no N+1 loading.
- **Orchestration only**: this layer determines what should happen next. It does
  not execute external actions.

This layer determines what should happen next. It does not execute external actions.


- Real external API executions against paid/social providers (scaffold adapters stay honestly
  inert; the Phase 9A orchestrator runs them the moment real adapters exist).
- Executing AI Income Lab implementation / revenue actions after handoff.
- Automatic application of suggested scores (still a human-confirmed suggestion).
- OAuth/SSO and email verification; password reset flow.
- Distributed rate limiting (the in-memory boundary protects a single instance only) and
  account-recovery flows.
## Phase 14 — Production Hardening + Observability

Phase 14 adds deterministic internal health, safe operational events, failure
classification, and recovery recommendations. These are read models and
advisory decisions; they do not add a second source of truth.

- **Health model**: `src/lib/system-health.ts` reports `HEALTHY`, `DEGRADED`,
  `BLOCKED`, or `UNKNOWN` across persistence, authentication, research,
  validation, readiness, decision, portfolio, experiments, handoff, execution,
  agent runtime, and the integration registry. External provider health remains
  `UNKNOWN` until a real health check runs; configuration alone is not health.
- **Operational events**: `src/lib/operational-events.ts` defines typed events,
  severities, safe messages, optional owner-scoped identifiers, and preserved
  data classes. Credential, cookie, authorization, token, and connection-string
  patterns are redacted before display.
- **Failure and recovery**: `src/lib/failure-classification.ts` and
  `src/lib/recovery-policy.ts` classify failures deterministically and return
  only a recommended action. Timeouts and rate limits can recommend bounded
  backoff; authentication, authorization, validation, and data-integrity errors
  are not blindly retried. Approval and capability gates remain authoritative.
- **Idempotency audit**: existing unique research evidence hashes, metric
  period/source uniqueness, handoff task keys, integration execution request
  keys, and `AgentExecution.idempotencyKey` protections were retained. The agent
  runtime retry path now uses deterministic failure classification instead of
  treating every failure as retryable.
- **Security**: both new endpoints require authentication. Operations are
  owner-scoped through existing opportunity/task/execution ownership and exclude
  samples. Health responses contain component diagnostics only, not opportunity
  names, research content, experiment payloads, task details, or secrets.
- **Data class**: `REAL_DATA`, `ESTIMATED_DATA`, `SAMPLE_DATA`, and `UNKNOWN`
  remain distinct. Health and operations never upgrade non-real data into
  real-world validation.
- **APIs**: `GET /api/system/health` and `GET /api/system/operations`. Both are
  bounded, read-only, and make no external API calls.
- **UI**: `SystemHealthPanel` and `OperationalStatusPanel` are shown on the
  existing `/agents` control page and link to existing surfaces.
- **Bounds**: health uses a single owner-scoped persistence probe; operations
  uses batched counts plus the existing bounded decision loader, capped at 50
  opportunities, 200 research runs, 100 experiments, 60 metrics per experiment,
  and 200 tasks/executions. No N+1 or portfolio recalculation is introduced.

Known limitations: health is a lightweight internal snapshot rather than a
provider probe, operational event records remain emitted through existing logs
rather than a new persistence table, and no uptime, fake percentage, or invented
measurement is reported.

This phase provides observability and recovery decisions. It does not execute external actions automatically.

## Phase 15 — Live Provider Activation Readiness

Phase 15 audits the existing integration contracts and adds deterministic,
API-independent activation metadata for providers already represented in the
repository. It does not require credentials, call providers, or change the
provider architecture.

- **Activation states:** `NOT_CONFIGURED`, `CONFIGURED`,
  `READY_FOR_HEALTH_CHECK`, `HEALTHY`, `DEGRADED`, `AUTH_FAILED`,
  `CREDIT_LIMITED`, `RATE_LIMITED`, `UNAVAILABLE`, and `DISABLED`.
  Configuration alone never produces `HEALTHY`.
- **Checklist and matrix:** `src/lib/integrations/provider-checklist.ts` and
  `src/lib/integrations/provider-capability-matrix.ts` reuse the existing
  adapter capability, permission, and approval contracts. Dangerous publish,
  messaging, campaign, and spend capabilities remain approval-gated.
- **Safe plan:** `src/lib/integrations/live-test-plan.ts` returns a bounded
  activation order and stops at `LIVE_WRITE_TEST_REQUIRES_APPROVAL` for
  write-side capabilities. It performs no external action.
- **Credit handling:** billing/credit failures map to `CREDIT_LIMITED` and are
  non-retryable; a configured provider with a credit issue is not healthy or
  executable until resolved.
- **API and UI:** authenticated `GET /api/integrations/activation` and the
  `/integrations` activation panel expose safe metadata, variable names,
  capabilities, and next steps only. No secret values or external probes.
- **Health integration:** the Phase 14 health snapshot now includes safe
  provider activation states and does not report configured-but-unchecked
  providers as healthy.

The live activation order is documented in `docs/environment.md`: configure
server-side, verify secret isolation, run and persist a real health check,
perform a minimal safe read/search test through existing execution gates,
persist `IntegrationExecution`, normalize/classify the result, bridge only
measurable `REAL_DATA` to `ExperimentMetric`, verify operational events and
approval gates, then run an end-to-end test. Write-side capabilities are never
executed automatically.

This phase prepares live provider activation. It does not execute external
actions automatically.

## Phase 17 — Controlled Live Provider Activation + First Research/Evidence Loop

Phase 17 adds a controlled activation boundary around the existing integration,
execution, research, evidence, and decision contracts. It does not add a
provider, paid service, dependency, credential, or fake response. The only
schema change is the additive Phase 17 IntegrationHealth latency/data-class
metadata required to persist the real-check contract.

- **Controlled activation:** `src/lib/integrations/live-activation-controller.ts`
  verifies configuration, real health, capability, approval, and execution
  safety before one allowlisted live test. Server wiring reuses the existing
  `IntegrationHealth`, AgentTask, AgentExecution, and IntegrationExecution path.
- **Provider normalization:** `live-provider-normalization.ts` returns only safe
  metadata and maps auth, credit, rate-limit, timeout, unavailable, malformed,
  empty, validation, and success outcomes without raw headers or credentials.
- **First research cycle:** `POST /api/research/live-cycle` is owner-scoped and
  health-gates the existing Brave/Reddit/Google Trends research adapters before
  invoking the existing `runResearch` and transactional research repository.
  The existing decision pipeline is recomputed afterward; no second research
  system is introduced.
- **REAL_DATA integrity:** provider health, source/provider, operation, source
  URL, observation timestamp, research-run relationship, and evidence identity
  are required. Missing provenance downgrades a live-data claim. Sample,
  estimated, AI-generated, and unknown data are never upgraded to REAL_DATA.
- **Safety:** only allowlisted read/search/draft operations are live-testable.
  `PUBLISH`, `SEND_MESSAGE`, `CREATE_CAMPAIGN`, `SPEND_MONEY`, and upload remain
  approval-gated; write-side tests return `LIVE_WRITE_TEST_REQUIRES_APPROVAL`.
  Credit/billing failures are non-retryable and never spend automatically.
- **Idempotency and audit:** safe live tests reuse the existing execution
  idempotency key and bounded request id. The live research run uses a stable
  request-derived primary key so a repeated request does not create a second
  ResearchRun. Operational events use the Phase 14 model and sanitized logging.
- **UI:** `/integrations` exposes controlled activation and safe live-test
  actions. Owned opportunity research uses the controlled live-cycle route;
  sample opportunities retain the explicitly labeled demo path.
- **Documentation:** `docs/environment.md` and `docs/integrations.md` contain the
  credential, activation, provenance, rollback, and stop-condition rules.

This phase makes the existing system capable of a controlled first live cycle.
It does not claim the system is live, fabricate provider health or evidence, or
execute dangerous external actions automatically. If provider credentials are
not configured, activation remains `NOT_CONFIGURED` /
`READY_FOR_HEALTH_CHECK` and no real provider call is performed.

## Phase 16 — Pre-Live Launch Gate

Phase 16 adds an API-independent pre-live launch gate and end-to-end readiness
snapshot. It audits the existing discovery → research → evidence → validation
→ intelligence → readiness → decision → portfolio → experiment → operating loop
→ learning → handoff → execution → measurement → reassessment lifecycle without
creating a second source of truth.

- **Internal readiness:** `LaunchReadiness` reports the engineering score and
  15 deterministic gates. The score is not revenue, profitability, market, or
  business-success probability.
- **Provider readiness:** provider activation remains `PENDING` until a real
  server-side configuration and persisted health check exist. A configured
  provider is never marked healthy by configuration alone.
- **Live testing:** `GATE_15_LIVE_TEST` remains `PENDING` in Phase 16. The
  system does not claim to be live and does not make provider calls.
- **Security gates:** authentication, owner isolation, approval, capability,
  integration permission, execution state, publishing, messaging, campaign,
  and spending boundaries remain enforced by the existing architecture.
- **Data-class rules:** `REAL_DATA`, `SAMPLE_DATA`, `ESTIMATED_DATA`, and
  `UNKNOWN` remain distinct through measurement, learning, health, and launch
  readiness. Non-real data is never upgraded to real-world validation.
- **Failure handling:** provider, database, validation, experiment, execution,
  duplicate, approval, timeout, rate-limit, and credit failures flow through
  classification, recovery recommendations, safe operational events, and
  bounded health/operations reporting.
- **API and UI:** authenticated `GET /api/system/launch-readiness` and
  `LaunchReadinessPanel` on the Agents control page show every gate, blockers,
  warnings, and pending provider/live-test states.
- **Saturday activation sequence:** the exact manual order is documented in
  `docs/live-activation-runbook.md`, including read-only tests, safe write
  tests, approval-required tests, and forbidden automatic actions.

Phase 16 provides a pre-live launch gate. It does not claim the system is LIVE
and does not execute external actions automatically.

## Phase 18 — Autonomous Execution & Feedback Bridge

Phase 18 connects the experiment layer to the execution layer and prepares the
feedback bridge:

- **Execution → measurement linkage:** agent executions for an opportunity's
  experiment flow through the existing execution repository and orchestrator;
  every execution is idempotent (unique idempotency key) and approval-gated.
- **Feedback contract (prepared):** the provider-neutral
  `ExternalFeedbackAdapter` boundary exists with truthful statuses
  (`HEALTHY`, `NOT_CONFIGURED`, `UNAVAILABLE`, `AUTH_FAILED`, `DISABLED`,
  `FAILED`). With no adapter configured, ingestion reports `NOT_CONFIGURED`
  and persists nothing.
- **REAL_DATA provenance:** metrics flowing into the experiment layer keep
  their data class end to end; `REAL_DATA` requires an explicit source.

Status: IMPLEMENTED / TEST-VERIFIED. Live execution and external feedback
remain NOT VERIFIED (no credentials/adapter configured).

## Phase 19 — Autonomous Opportunity Execution Loop

Phase 19 adds the bounded opportunity operating loop:

- OBSERVE → ASSESS → SELECT → ACTION → RECOVER/REASSESS cycle with
  deterministic queues and explicit reasons.
- `PORTFOLIO_CYCLE_LIMITS` bound experiments, executions, research runs, and
  retries per cycle; the controller defers rather than overruns.
- Approval gates remain mandatory; `WAITING_APPROVAL` and `BLOCKED` tasks are
  observed as persisted facts, never overridden.

Status: IMPLEMENTED / TEST-VERIFIED. Autonomous execution of real external
actions remains NOT VERIFIED (requires provider + approval).

## Phase 20 — Autonomous Portfolio Operations

Phase 20 composes the operating loop with portfolio intelligence:

- Portfolio-level health, circuit breaker, and recovery policy are reused;
  the operating loop never bypasses them.
- Learning-aware decisions use the existing Phase 6C/22 learning services;
  no second ranking system was added.
- Operational events record observed state with sanitized logging.

Status: IMPLEMENTED / TEST-VERIFIED. Unattended real-world operation remains
NOT VERIFIED by design (GATE_15_LIVE_TEST stays PENDING until a real live
provider test is executed).

## Phase 21 — External Feedback Bridge

Phase 21 finalizes the external feedback boundary:

- `ExternalFeedbackAdapter` + ingestion service: adapters must pass a real
  HEALTHY health check before any fetch; configuration alone is never health.
- Ingestion is owner-scoped and idempotent (duplicate external events are
  rejected), flows through the ExperimentMetric model, and preserves
  `REAL_DATA`/`ESTIMATED_DATA`/`NOT_MEASURED` semantics.
- `POST /api/experiments/:id/feedback/ingest` truthfully returns 503
  `NOT_CONFIGURED` until an owner-configured adapter is injected server-side.
- No external feedback provider is currently configured: the boundary is
  architecturally complete, the integration is NOT CONFIGURED (by design,
  awaiting a chosen provider + credentials).

Status: IMPLEMENTED / TEST-VERIFIED. External feedback data flow: NOT
CONFIGURED (requires a real adapter + provider credentials).

## Phase 22 — Closed-Loop Income Intelligence

Phase 22 closes the measurement → learning → reassessment → reprioritization
loop on real measurements only:

- Feedback aggregation and learning run on persisted ExperimentMetric rows;
  missing data stays `NOT_MEASURED`, never zero.
- `rerankOpportunities` is deterministic and idempotent: scores recompute from
  the research base score + bounded experiment delta, clamped to [0, 100], and
  changes are persisted as append-only RankingSnapshot rows.
- Contradictions and insufficient-data states are surfaced honestly; no
  fabricated revenue, users, conversions, or provider responses.

Status: IMPLEMENTED / TEST-VERIFIED. Learning on real production data remains
NOT VERIFIED (requires real measurements from a real experiment).

## Phase 23 — Autonomous Growth & Experiment Portfolio

Phase 23 adds a bounded growth read-model over the existing systems:

- `GET /api/growth/portfolio` + `/growth` UI compose the existing portfolio
  intelligence, Phase 19/20 operating controller, and Phase 22 closed loop —
  no new scoring system (existing prioritization weights stay authoritative).
- Capacity observes the SAME limits the controller enforces
  (`PORTFOLIO_CYCLE_LIMITS`: max 3 experiments, 2 executions, 2 research runs)
  with AVAILABLE / AT_CAPACITY / STARVED / BLOCKED states.
- Runaway-signal detection (RETRY_EXHAUSTED, UNMEASURED_BACKLOG,
  ESTIMATED_ONLY_DATA) is advisory and derived from persisted facts only.
- Bounded owner-scoped reads (≤50 opportunities, ≤100 experiments, ≤200 metric
  rows, ≤100 tasks); sample rows always excluded.

Status: IMPLEMENTED / TEST-VERIFIED (13 engine tests).

## Phase 24 — Production Autonomous Income Platform Integration

Phase 24 adds full-lifecycle production visibility:

- `GET /api/system/platform` + `/platform` UI report the 13 lifecycle stages
  DISCOVER → RESEARCH → VERIFY → VALIDATE → DECIDE → SELECT → EXPERIMENT →
  EXECUTE → MEASURE → LEARN → REASSESS → GROW → FEEDBACK, mapping each to the
  existing SystemHealth components and persisted counts.
- 13 fail-closed readiness gates; PENDING is never considered HEALTHY.
- The snapshot carries an explicit `unverifiedInProduction` list — production
  reality (live providers, real data, real execution) is NOT VERIFIED and is
  reported as such rather than assumed.

Status: IMPLEMENTED / TEST-VERIFIED (13 engine tests). Production reality:
NOT VERIFIED — see Phase 25/26 below.

## Phase 25 — Production Activation & First Real Loop

Phase 25 activates the existing architecture without weakening any fail-closed
behavior. Implemented:

- **CI lint:** `.github/workflows/ci.yml` now runs `npm run lint` explicitly
  (previously typecheck/test/build only; lint must not rely on build).
- **Deployment readiness endpoint:** unauthenticated
  `GET /api/system/readiness` verifies database connectivity (`SELECT 1`),
  reports migration presence, and returns an honest 503 when the database is
  unreachable — no secrets, no user data, no provider status leakage.
- **Deployment configuration:** the repository keeps the existing
  Vercel-compatible Next.js + PostgreSQL architecture (`next build`,
  `prisma migrate deploy`, `DATABASE_URL`). No new infrastructure was added.
  Production deployment itself has NOT been performed in this environment:
  **NOT VERIFIED — DEPLOYMENT CREDENTIALS REQUIRED** (a Postgres instance and
  hosting environment with `DATABASE_URL` must be supplied by the operator).
- **Environment activation:** all provider keys are read server-side only,
  never bundled to the client; the full classification and required keys are
  documented in `docs/environment.md`. Nothing was marked healthy by
  configuration alone.
- **Provider activation path:** the existing registry + health-check
  architecture is the single activation path (no second provider system).
  SambaNova previously returned HTTP 402 (key authenticated, no credits) —
  the honest statuses (`FAILED`, `CREDIT_LIMITED` semantics) stand; no fake
  AI responses exist. Until credentials with credits are supplied, AI-provider
  capabilities remain NOT CONFIGURED / BLOCKED externally.
- **Research path:** Brave/Reddit/SerpApi adapters degrade gracefully when
  unconfigured (`CONFIG_ERROR`, never fake evidence). With credentials
  supplied, Reddit requires no key and Brave/SerpApi become `REAL LIVE DATA`
  paths. No research run was executed in this environment (no live provider
  access), so the first real research run remains **NOT VERIFIED — EXTERNAL
  PROVIDER ACCESS REQUIRED**.
- **First real opportunity / experiment / REAL_DATA metric:** the full chain
  (validated opportunity → handoff → experiment → metric with provenance →
  learning) is implemented and test-verified; actual execution requires real
  provider data and a human-run experiment. All remain **NOT VERIFIED — REAL
  PROVIDER DATA REQUIRED**. Approval gates were not bypassed.

## Phase 26 — Revenue & Growth Operations

Phase 26 adds the minimum data-driven operational layer on measured data,
reusing Phase 6B aggregation and Phase 23 growth state (no parallel revenue
model, no new scoring):

- **Revenue intelligence engine** (`src/lib/revenue-intelligence.ts`, pure +
  deterministic): per-experiment revenue/cost/profit/ROI/conversions computed
  ONLY from `REAL_DATA` records via the existing `summarizeMetricSeries`;
  estimated records are counted but never upgrade any claim. Outcomes are
  classified from persisted decisions: MEASURED_POSITIVE, MEASURED_NEGATIVE,
  UNCERTAIN (a WIN/STOP decision without real measurements is never
  upgraded), NOT_MEASURED, AWAITING_MEASUREMENT, REQUIRES_REVIEW, BLOCKED.
  Measurement completeness = distinct recorded metrics / 7; unknowns are
  never padded with zeros.
- **Operational recommendations** (states, not a score, each citing its
  persisted evidence): CONTINUE_EXPERIMENT, COLLECT_MORE_DATA, PAUSE,
  REASSESS, HUMAN_REVIEW, SCALE_CANDIDATE, LOW_SIGNAL, INSUFFICIENT_DATA.
  Approval gates stay mandatory: a WAITING_APPROVAL task forces HUMAN_REVIEW
  even with a winning outcome.
- **API + UI:** owner-scoped `GET /api/growth/revenue` (requireUser, bounded
  reads ≤100 experiments / ≤200 metric rows, sample rows excluded) and a
  clearly labeled revenue-intelligence card on `/growth` showing real
  revenue/cost/conversions, per-experiment outcomes, recommendations with
  evidence, and data classes (REAL_DATA / ESTIMATED_DATA / NOT_MEASURED).
- **Honest empty state:** with no real data the portfolio reports an
  INSUFFICIENT_DATA provenance note and NOT_MEASURED totals — growth
  optimization is not pretended.
- **External feedback adapter:** still NOT CONFIGURED (no provider selected /
  credentials available). The Phase 21 boundary remains the single insertion
  point; when a provider is chosen, implement ONE adapter through
  `ExternalFeedbackAdapter` — provider-specific logic stays out of the core
  learning engine.

Status: IMPLEMENTED / TEST-VERIFIED (14 engine tests). Revenue operations on
real data remain NOT VERIFIED until Phase 25 activation supplies real
measurements.

## Phase 27 — Production Readiness Audit + Autonomous Reliability Hardening

Phase 27 is an audit-first pass over Phases 1–26 that implements only confirmed fixes. No
architecture was rewritten, no schema semantics changed, no provider faked, and no approval gate
bypassed.

**Findings (post-audit):**

- **HIGH — Phase 26 revenue service global metric bound** (`revenue-intelligence-service.ts`):
  metric rows were loaded with one global `take: 200` across the whole portfolio. Past that cap,
  older experiments lost their real rows and were silently misclassified as NOT_MEASURED — a
  data-honesty defect, not merely a performance one. **Fixed:** metrics now load via a bounded
  per-experiment include (`MAX_METRIC_ROWS_PER_EXPERIMENT: 200`, matching the established
  decision-loader pattern), every experiment keeps its own real data, and a `truncated` flag plus a
  visible `/growth` notice report honestly when an experiment exceeds even the per-experiment cap.
- **False positive cleared:** an initial suspicion that `AgentTask` lacked owner/status indexes was
  wrong — `@@index([ownerId, status])` already exists in the schema. No migration was added.
- **No other confirmed Critical/High/Medium defects:** authentication coverage (every API route
  requires a session; `/api/system/readiness` is intentionally the only public endpoint and leaks
  no user data, counts, provider status, or secrets), owner scoping with 404-masking, sample-row
  exclusion, provider status honesty (NOT_CONFIGURED / FAILED / CREDIT_LIMITED semantics),
  autonomy bounds and fail-closed gates, REAL_DATA provenance enforcement, and the idempotency
  infrastructure (unique execution keys, metric period/source uniqueness, append-only snapshots)
  were re-verified and stand as implemented in Phases 1–26.

**Tests added:** per-experiment bound fairness across experiments, truncation observability, and
owner isolation of the revenue queries (stubbed Prisma surface — fixtures are TEST DATA, never
REAL_DATA).

## Verification status summary (post Phase 27)

| Capability | State |
| --- | --- |
| Implementation, tests, typecheck, lint, build | PASS (CI runs all incl. lint) |
| Production deployment | NOT VERIFIED — DEPLOYMENT CREDENTIALS REQUIRED |
| Provider health (AI) | BLOCKED externally (SambaNova HTTP 402: no credits) |
| Research providers | CONFIG-DEPENDENT (keys required; Reddit keyless) |
| First real research run / opportunity | NOT VERIFIED — EXTERNAL PROVIDER ACCESS REQUIRED |
| First real experiment + REAL_DATA metric | NOT VERIFIED — REAL EXPERIMENT REQUIRED (human-controlled, approval-gated) |
| External feedback | NOT CONFIGURED (adapter boundary ready) |
| Revenue intelligence | IMPLEMENTED; reports INSUFFICIENT_DATA until real metrics exist |
## Production Activation Pack (post Phase 27)

Documentation-only preparation for eventual real-world activation — no new product phase, no code
changes required:

- `docs/PRODUCTION_ACTIVATION.md` — full activation inventory (A–P with per-item status), the
  complete environment-variable audit, the deployment runbook, the observability checklist, and
  the rollback/failure plan
- `docs/PROVIDER_ACTIVATION.md` — provider-by-provider matrix separating CODE IMPLEMENTED from
  PROVIDER LIVE from REAL DATA VERIFIED (no provider is live today)
- `docs/FIRST_REAL_LOOP.md` — first real research run, first human-controlled experiment, the
  REAL_DATA verification gate, and the four-level revenue verification gate
