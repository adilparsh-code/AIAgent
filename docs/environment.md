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
