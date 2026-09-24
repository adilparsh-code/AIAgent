# Server-side environment reference

All configuration is **server-side only**. Never prefix a value with
`NEXT_PUBLIC_*`, never commit a real `.env`, and never return a value through
an API — APIs expose variable **names and presence only**, plus provider
status, last health check, sanitized error, and capabilities.

> This file is the authoritative variable reference for
> `.env.example`. The Freebuff workspace blocks direct writes to `.env*`
> files, so the template below is maintained here and mirrored by
> `docs/integrations.md` and the README.

## Core

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (server-only). All persistence. |

## AI provider — SambaNova (Phase 8/9: content drafts, reports, test executions)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SAMBANOVA_API_KEY` | for live AI | Bearer token, read only in server code. Without it the adapter reports `NOT_CONFIGURED` and executions end `UNAVAILABLE` — output is never fabricated. |
| `SAMBANOVA_BASE_URL` | no | Override the OpenAI-compatible endpoint (default `https://api.sambanova.ai/v1/chat/completions`). |
| `SAMBANOVA_MODEL` | no | Model id (default `Meta-Llama-3.1-8B-Instruct`). |
| `AI_PROVIDER_ENV` | no | `LIVE` or `TEST`. Labels the environment so test configuration is always distinguishable from production; defaults to `UNKNOWN`. |

## AI provider — generic OpenAI-compatible endpoint (Phase 7 agent runtime)

Any provider exposing `/chat/completions` works here. Leave empty to use the
SambaNova adapter.

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER_API_KEY` | for live AI | Server-only key. When absent the runtime reports `UNAVAILABLE` instead of generating anything. |
| `AI_PROVIDER_BASE_URL` | no | Base URL (default `https://api.openai.com/v1`). |
| `AI_PROVIDER_MODEL` | no | Model id (default `gpt-4o-mini`). |
| `AI_PROVIDER_NAME` | no | Display name recorded in execution metadata. |

## Research providers (Phase 1 evidence, Phase 8/9 research adapters)

| Variable | Required | Purpose |
| --- | --- | --- |
| `BRAVE_SEARCH_API_KEY` | for Brave web search | Web-search evidence (demand, commercial intent, competition). Absent ⇒ `NOT_CONFIGURED`. |
| `SERPAPI_API_KEY` | for Google Trends | SerpApi `google_trends` engine. Returns normalized **relative** interest (0–100), never absolute volume. |
| `RESEARCH_PROVIDER_ENV` | no | `LIVE` or `TEST`; defaults to `UNKNOWN`. |

Reddit requires **no credentials** (public JSON endpoint). Some hosting
datacenter IPs are blocked by Reddit — the health check reports that honestly
as `AUTH_FAILED` (HTTP 403) instead of claiming success.

## Scaffold integrations (no real adapter yet)

`PINTEREST_ACCESS_TOKEN`, `YOUTUBE_API_KEY`, `AFFILIATE_NETWORK_API_KEY`,
`MARKETPLACE_API_KEY`, `ANALYTICS_PLATFORM_API_KEY`.

Even with values present these stay `CONFIGURED` (never `HEALTHY`) and
`execute()` returns `BLOCKED` — they cannot fabricate success.

## Rules

1. A provider is `HEALTHY` only after a real network/authentication probe
   succeeds. Configuration presence alone is never `HEALTHY`.
2. Missing configuration is `NOT_CONFIGURED`, never a silent success.
3. Secrets never reach: the browser, the model prompt, PostgreSQL, logs, URLs,
   or API responses. Only names, presence, status, and sanitized errors.
4. Production values are set through the hosting provider's environment
   settings; the sandbox `.env` values are development defaults.

## Phase 15 — Live provider activation readiness

Phase 15 is API-independent. It does not request credentials, call a provider,
or change the existing provider architecture. The activation API returns only
provider names, environment-variable names, status, capabilities, and safe
reasons.

| Provider | Required variables | Optional variables | Credential required | Current adapter |
| --- | --- | --- | --- | --- |
| Generic OpenAI-compatible agent runtime | `AI_PROVIDER_API_KEY` | `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_MODEL`, `AI_PROVIDER_NAME`, `AI_PROVIDER_ENV` | yes | existing runtime adapter; no IntegrationHealth row yet |
| SambaNova | `SAMBANOVA_API_KEY` | `SAMBANOVA_BASE_URL`, `SAMBANOVA_MODEL`, `AI_PROVIDER_ENV` | yes | implemented |
| Brave Search | `BRAVE_SEARCH_API_KEY` | `RESEARCH_PROVIDER_ENV` | yes | implemented |
| Reddit | none | `RESEARCH_PROVIDER_ENV` | no | implemented |
| Google Trends via SerpApi | `SERPAPI_API_KEY` | `RESEARCH_PROVIDER_ENV` | yes | implemented |
| Pinterest, YouTube, affiliate network, marketplace, analytics platform | provider-specific scaffold variable | none | per scaffold | disabled scaffold only |

Use placeholders only when documenting a setup. Put values in the hosting
provider's server-side environment settings. Never use `NEXT_PUBLIC_*` for a
credential, never commit `.env` files, and never return values from an API or
log.

### Activation status and health behavior

- `NOT_CONFIGURED`: required variables are absent; no call is attempted.
- `READY_FOR_HEALTH_CHECK`: configuration is present but no successful real
  health check is recorded. It is not `HEALTHY`.
- `HEALTHY`: only a real health/authentication probe succeeded.
- `AUTH_FAILED`, `CREDIT_LIMITED`, `RATE_LIMITED`, `UNAVAILABLE`, and
  `DEGRADED`: the last real check observed that condition. Credit and billing
  failures are not retried automatically.
- `DISABLED`: scaffold or explicitly disabled integration; no live action.

### Safe activation procedure

1. Configure the provider secret server-side.
2. Verify the secret is not exposed to the client, logs, prompts, or API.
3. Run the existing real health-check route and review its sanitized result.
4. Confirm the existing `IntegrationHealth` row was persisted.
5. Run only a minimal safe read/search capability through the existing
   authenticated execution flow; do not run write-side capabilities.
6. Confirm the `IntegrationExecution` audit row and response normalization.
7. Bridge a measurable result to `ExperimentMetric` only when the existing
   contract marks it `REAL_DATA`.
8. Verify the safe operational event, health dashboard, no-secret audit, and
   approval gates before any end-to-end test.

This phase documents readiness and safe decisions. It does not execute external
actions automatically.
