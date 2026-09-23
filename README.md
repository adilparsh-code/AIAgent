# AI Income Lab — AIAgent (Phase 5 complete)

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

## Intentionally deferred

- Autonomous agent execution (AgentRun rows exist for audit; no agent logic runs yet).
- Executing AI Income Lab implementation / revenue actions after handoff.
- Cross-run evidence correlation and historical trend storage.
- Automatic application of suggested scores (still a human-confirmed suggestion).
- OAuth/SSO and email verification; password reset flow.
- Distributed rate limiting (the in-memory boundary protects a single instance only) and
  account-recovery flows.
- Automatic re-ranking from experiment feedback (deferred to Phase 6C by design).
- Broader provider coverage and richer query strategies.
