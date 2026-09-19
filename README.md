# AI Income Lab — AIAgent (Phase 1 complete)

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
   → Run persisted (ResearchRun / ResearchQuery / Evidence / ResearchFinding)
   → Result displayed honestly in the UI
```

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
| `DATABASE_URL` | PostgreSQL connection string (server-only). |
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

# Start the app
npm run dev
```

Open `http://localhost:3000`. Without `DATABASE_URL`, the UI still shows in-repo sample/demo data;
create/update/delete and live research persistence require PostgreSQL.

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
   with its queries, evidence, findings, signals, and conclusion.

## Security notes

- API keys are read only in server code (`process.env`); nothing is exposed via `NEXT_PUBLIC_*`.
- All API input is validated and length-capped (title ≤ 240 chars, ids ≤ 64 chars, history limit ≤ 50).
- Provider content is HTML-stripped before storage/rendering; URLs must be http(s) — `javascript:` /
  `data:` URLs are dropped, and links render with `rel="noopener noreferrer nofollow"`.
- Errors never include credentials (verified by unit test for the Brave provider).
- `.gitignore` covers `.env` and `.env*.local`; no secrets are committed.

## Phase 1 status

Complete: research architecture (providers → evidence → findings → validation → conclusion),
provider abstraction with injection for tests, evidence normalization/dedup/contradiction handling,
evidence-driven validation signals and conclusions, research-informed scoring guidance, research run
history in UI + PostgreSQL, honest provider status reporting, SerpApi-based Google Trends provider,
expanded test suite (60 tests), CI workflow, and documentation.

## Intentionally deferred to Phase 2

- Broader provider coverage and richer query strategies (more purposes, localized queries).
- Automatic application of suggested scores (currently a suggestion requiring human confirmation).
- Historical trend storage and cross-run evidence correlation.
- Authentication/multi-tenancy for the dashboard.
- Phase 2 system scope: persistent Experiments, Products, Revenue, Agents, AgentRuns beyond the
  current schema, plus any PostgreSQL/Prisma schema evolution needed there.
