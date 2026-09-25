# First real loop — runbooks for the first REAL_DATA cycle

Bounded, observable, reproducible, human-reviewable, fail-closed procedures for the first real
research run, the first human-controlled experiment, and the objective gates for REAL_DATA and
revenue claims. **Nothing here has been executed; no step below may be claimed as verified until
performed against real infrastructure with real credentials.**

---

## 1. First real research run

Prerequisites (from `docs/PRODUCTION_ACTIVATION.md` §3 steps 1–8): deployed app, reachable DB,
operator account, at least one provider `HEALTHY`.

### Pre-run checklist (all must be true; otherwise STOP truthfully)

- [ ] `GET /api/system/readiness` → 200, `database: connected`, `migrationsApplied: true`
- [ ] Operator is logged in; session cookie is HttpOnly + Secure (HTTPS active)
- [ ] At least one research provider health row is `HEALTHY` (persisted, not assumed) — Reddit may
      be keyless but is subject to IP/rate-limit failures; Brave/SerpApi need keys
- [ ] `RESEARCH_PROVIDER_ENV=LIVE` is set on the server (so the run is labeled as live, never
      confused with test/sample data)
- [ ] No fabricated fallback exists in the path (verified by design: unconfigured providers yield
      `CONFIG_ERROR`; nothing pretends success)

### Procedure

1. Create or select an owned opportunity (non-sample) in the UI.
2. Trigger **one** bounded live research cycle: `POST /api/research/live-cycle` (owner-scoped,
   health-gated, idempotent by stable request-derived key — a repeated request does not create a
   second ResearchRun).
3. Review the persisted run: per-provider status (`SUCCEEDED`/`EMPTY`/`CONFIG_ERROR`/`FAILED`/
   `UNAVAILABLE`), evidence with source/URL/hash/dataClass, findings, validation signals,
   contradictions, confidence, conclusion, scoring guidance.
4. Recompute and review the decision (`GET /api/opportunities/:id/decision`) — the decision
   pipeline reads the same persisted facts; nothing was re-ranked or invented.

### Post-run verification (defines REAL-DATA-VERIFIED for this run)

- [ ] ResearchRun + ResearchSource(s) + Evidence + Findings + Validation rows exist for the owner
- [ ] Every evidence item carries provider, source URL, observation timestamp, content hash, and
      data class; the run is visible after a full browser refresh and server restart
- [ ] Conclusion is evidence-driven (`VALIDATED`/`PROMISING`/`INSUFFICIENT_EVIDENCE`/
      `CONTRADICTED`/`REQUIRES_HUMAN_REVIEW`) — never inferred from research success
- [ ] Provider statuses are truthful; any failed provider appears as failed

### Stop conditions

No provider `HEALTHY` → STOP at provider activation. Run failed/empty → record truthfully, fix,
re-run. **Never manufacture evidence to satisfy the phase.**

## 2. First human-controlled experiment

Prerequisites: an opportunity whose persisted validation permits implementation
(`VALIDATED` or `REQUIRES_HUMAN_REVIEW`) — i.e., it passed the existing handoff eligibility gate.

### Sequence (mandatory approval points marked)

1. Review the opportunity's decision + readiness panels; resolve any `REVIEW_CONFLICT` /
   `HUMAN_REVIEW` first (persisted contradictions block execution by design).
2. Create the handoff contract (`POST /api/discovery/candidates/:id/handoff` or the opportunity
   page action). Ineligible requests return 422 with explicit reasons and persist nothing.
3. **HUMAN APPROVAL MANDATORY:** accept the handoff deliberately
   (`action: accept`). Acceptance re-checks eligibility; the create-experiment action commits the
   experiment (status `READY`, budget/time limits from the contract) + the `COMPLETED` handoff
   transition in one transaction. No campaigns launch; no money moves.
4. **HUMAN APPROVAL MANDATORY before any consequential execution:** any capability involving
   SPENDING, PAYMENTS, PUBLISHING, MESSAGING, CAMPAIGNS, or account mutation requires the owner's
   explicit approval through the existing gate (AgentTask `WAITING_APPROVAL`) — there is no
   autonomous path, and write capabilities are never auto-retried. Read/search actions run
   tenant-scoped without approval; the recommendation engine forces `HUMAN_REVIEW` while any
   `WAITING_APPROVAL` task exists, even with a winning outcome.
5. Execute only what was approved, through the existing orchestrator (bounded attempts, unique
   idempotency key — duplicates resolve to the same execution, never a second one).
6. Record real measurements as they actually occur (step 3).
7. Evaluate (`POST /api/experiments/:id/evaluate`): decision follows the documented thresholds;
   missing data ⇒ `INSUFFICIENT_DATA`, never a fabricated verdict.
8. Learning + optional manual rerank: deterministic, bounded ±10 delta over the research base
   score, append-only RankingSnapshot audit trail; estimated data never receives the weight of
   real data.

## 3. REAL_DATA verification gate

Claim **REAL_DATA VERIFIED** for a measurement only when ALL of the following exist:

1. An actual provider/experiment response occurred in the real world (not simulated);
2. A persisted `ExperimentMetric` (or Evidence) row with `dataClass = REAL_DATA`;
3. A non-empty `source` provenance on that row (enforced: REAL_DATA without source is rejected at
   ingestion);
4. Ownership traceable to the authenticated owner (metric → experiment → opportunity → ownerId);
5. An associated experiment/handoff context (the measurement belongs to a real experiment);
6. Real measurement timestamp (`recordedAt`, `periodStart/periodEnd`);
7. Reproducible retrieval: the row survives restart and is re-fetchable through the owner-scoped
   API (`GET /api/experiments/:id/metrics`).

**NOT sufficient evidence (never acceptable):** a mocked response; a test fixture; a sample row
(`isSample: true`); an estimated metric (`ESTIMATED_DATA`); a screenshot without provenance; a
successful code path; the existence of an adapter; a configured provider. Zero is never a
substitute for missing data; estimated data is never upgraded.

## 4. Revenue verification gate

Four distinct levels — never conflate them:

| Level | Meaning | Evidence required |
| --- | --- | --- |
| IMPLEMENTATION | The revenue math exists and is deterministic | Code + unit tests (true today: `metric-aggregation`, `revenue-intelligence`, `experiment-evaluation`) |
| REVENUE CALCULATION | The math ran over real recorded inputs | A persisted metric summary derived from REAL_DATA rows with provenance; ROI only where both cost and revenue are real; zero-cost ⇒ ROI null (never infinite) |
| MEASURED REVENUE | A real measurement was recorded | `ExperimentMetric` rows with `dataClass = REAL_DATA`, non-empty `source`, real timestamps, owner-scoped, passing the §3 gate |
| ACTUAL MONEY RECEIVED | Funds actually landed | Bank/payment-provider statement or payout record reconciled to the persisted MEASURED REVENUE entries (currency, amount, date, counterparty) — this is outside the system's DB and requires the operator's financial records |

Until level 3 exists, the system truthfully reports `INSUFFICIENT_DATA` / `NOT_MEASURED` on
`/growth` — growth optimization is not pretended. A positive computed outcome never implies future
income, and no recommendation claims success without real outcome data.

## 5. Failure handling during the first loop

Every failure path lands in a truthful state (see `docs/PRODUCTION_ACTIVATION.md` §5 for the full
table): provider failures → persisted FAILED/AUTH_FAILED/CREDIT_LIMITED; research failure → FAILED
run, no evidence invented; validation failure → INSUFFICIENT_EVIDENCE/REQUIRES_HUMAN_REVIEW;
metric issues → NOT_MEASURED/409 on duplicates, append-only corrections; contradictory metrics →
HUMAN_REVIEW (never silently resolved); gate blocks → intended fail-closed behavior, resolve the
blocker, never bypass.
