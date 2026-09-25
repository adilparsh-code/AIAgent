# Provider activation matrix

Truthful provider state after the Phase 27 audit at baseline
`5a8d7ae4d11a8448b363c60e1c180b59666c06dc`. This document distinguishes **CODE IMPLEMENTED** (the
adapter exists and is test-verified) from **PROVIDER LIVE** (a real health check against a real
account succeeded) from **REAL DATA VERIFIED** (real provider data was persisted with provenance).

**No provider is currently LIVE. No provider has REAL DATA VERIFIED status in this environment.**

## Implemented providers (registry `src/lib/integrations/registry.ts`)

| Provider | Purpose | Adapter Exists | Credential Needed | Health Check | Current State | Activation Action |
| --- | --- | --- | --- | --- | --- | --- |
| `sambanova` | LLM drafts/analysis (OpenAI-compatible chat completions) | YES — real 1-token authenticated completion probe | `SAMBANOVA_API_KEY` (+ optional `SAMBANOVA_BASE_URL`, `SAMBANOVA_MODEL`) | Real API call, persisted with latency + data class | CODE IMPLEMENTED; **NOT LIVE**. Historical real check: **HTTP 402** — key authenticated, account had no credits/subscription. `CREDIT_LIMITED`/`FAILED` semantics stand; `GENERATE_TEXT` never executed. | Supply account WITH credits → run health check via `/integrations` → expect `HEALTHY` before any execution |
| `brave-search` | Web-search evidence (demand, commercial intent, competition) | YES — real `GET /res/v1/web/search?q=test&count=1` probe | `BRAVE_SEARCH_API_KEY` | Real search API probe; 401/403 → `AUTH_FAILED`, 429 → `DEGRADED` | CODE IMPLEMENTED; **NOT LIVE**; never health-verified against a real account here | Add key → health check → one bounded `SEARCH_WEB` test execution |
| `reddit` | Community/pain-point signals (public endpoint, no key) | YES — public search JSON probe | None | Real public-endpoint probe | CODE IMPLEMENTED; **NOT LIVE** — historically returned HTTP 403 to this host's IP (IP-based block, not a code defect) | Re-run health check from the deployment network; rate limits may cause `FAILED` runs (documented, not fabricated around) |
| `google-trends` | Trends signals via SerpApi (`google_trends` engine) | YES — real engine probe | `SERPAPI_API_KEY` | Real API probe | CODE IMPLEMENTED; **NOT LIVE**; never health-verified | Add key → health check → one bounded `SEARCH_TRENDS` test execution |
| `pinterest` | Future publishing | Scaffold only — `execute()` returns BLOCKED ("not implemented") | Provider-specific | Never health-tested | SCAFFOLD — honestly inert; never claims HEALTHY; no PUBLISH capability granted | Not activatable without real adapter code (deliberately out of scope) |
| `youtube` | Future publishing | Scaffold only | Provider-specific | Never health-tested | SCAFFOLD — honestly inert | Not activatable without real adapter code |
| `affiliate-network` | Future reporting | Scaffold only | Provider-specific | Never health-tested | SCAFFOLD — honestly inert | Not activatable without real adapter code |
| `marketplace` | Future reporting | Scaffold only | Provider-specific | Never health-tested | SCAFFOLD — honestly inert | Not activatable without real adapter code |
| `analytics-platform` | Future reporting | Scaffold only | Provider-specific | Never health-tested | SCAFFOLD — honestly inert | Not activatable without real adapter code |
| External feedback (Phase 21 boundary) | External experiment feedback → ExperimentMetric | Contract implemented (`ExternalFeedbackAdapter`); **no adapter registered** | Provider-specific (to be chosen) | HEALTHY-gated before any fetch | BOUNDARY READY; **NOT_CONFIGURED by design** — ingestion returns 503 `NOT_CONFIGURED` | Choose a provider → implement ONE adapter behind the existing boundary → health check → ingest (idempotent) |

Not in the codebase (verified by search): OpenRouter, GLM, Tavily. Do not assume any of them is
integrated; a `provider-checklist` test explicitly asserts Tavily's absence.

## Status semantics (enforced, not aspirational)

- Configuration alone NEVER produces `HEALTHY` — a persisted real check is required.
- Failure statuses are actionable and secret-free: `AUTH_FAILED` (401/403), `FAILED`,
  `CREDIT_LIMITED` (402/billing — non-retryable, never spends), `DEGRADED` (rate-limited but
  authenticated), `NOT_CONFIGURED`, `UNAVAILABLE`.
- Health checks persist: status, sanitized error, latency, capabilities, environment label, data
  class (`IntegrationHealth`), plus an append-only `IntegrationExecution` audit row.
- Research evidence keeps `source`, URL, timestamp, provider, provenance, and data class end to
  end. No source ⇒ no REAL_DATA claim.

## What each provider level requires before it may be claimed

| Claim | Minimum evidence |
| --- | --- |
| CODE IMPLEMENTED | Adapter + tests in the repo (true today for the four live adapters) |
| PROVIDER LIVE | A persisted `IntegrationHealth` row with `HEALTHY` from a real account, plus latency |
| REAL DATA VERIFIED | A persisted ResearchRun/ExperimentMetric row whose `source` is the provider, with URL/timestamp/provenance, retrievable after restart |

Nothing in this repository may claim the second or third row today.
