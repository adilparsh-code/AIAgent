# Live activation runbook

Phase 16 is an API-independent pre-live gate. This runbook documents the
manual sequence for a future real activation. It does not configure providers,
call providers, or execute external actions.

## Test categories

- **READ-ONLY TESTS** — safe search/read probes that do not modify an external
  account or publish content. These are the only provider tests that may be
  considered for a minimal live activation check.
- **SAFE WRITE TESTS** — local draft/artifact creation through the existing
  task/execution flow when the capability is explicitly allowlisted. They must
  not publish, message, create campaigns, or spend money.
- **APPROVAL-REQUIRED TESTS** — `PUBLISH`, `SEND_MESSAGE`, `CREATE_CAMPAIGN`,
  and `SPEND_MONEY`. These stop at the existing owner approval gate.
- **FORBIDDEN AUTOMATIC ACTIONS** — no automatic publish, messaging, campaign
  creation, spending, secret logging, approval bypass, or blind retry after a
  possible external side effect.

## Exact activation order

1. **Configure provider secret** — set the provider value in the hosting or
   server-side environment settings. Never place it in client code or a
   committed file.
2. **Verify server-side storage** — confirm the deployment/runtime reads the
   variable server-side. Do not print or copy the value.
3. **Verify no secret exposure** — inspect the client bundle, API responses,
   logs, operational events, prompts, and persisted execution rows for secret
   patterns.
4. **Health check** — run the existing real provider health route. A
   configuration value alone is not a health result.
5. **Persist health** — confirm the existing `IntegrationHealth` record stores
   the sanitized status, timestamp, capabilities, and error summary.
6. **Minimal read/search test** — use the authenticated existing execution flow
   with one allowlisted, read-only capability and bounded payload.
7. **Normalize result** — verify the response uses the provider-agnostic
   contract and preserves `REAL_DATA` only for an actual provider response.
8. **Persist execution** — confirm `IntegrationExecution` records the safe
   execution metadata without secrets.
9. **Classify result** — verify success, auth failure, credit/billing failure,
   rate limit, timeout, unavailable provider, malformed response, and empty
   response map to the expected safe classification.
10. **Record operational event** — verify the event is safe, categorized, and
    free of credentials or sensitive payloads.
11. **Verify dashboard** — check system health and operational status without
    hiding provider or live-test pending states.
12. **Verify experiment metric bridge if applicable** — only a measured
    `REAL_DATA` result may become an `ExperimentMetric`; missing values remain
    null and sample/estimated/unknown data is not upgraded.
13. **Test approval gates** — verify each approval-required capability stops at
    the existing explicit owner approval boundary.
14. **Test safe execution** — verify ownership, capability, idempotency,
    execution-state, retry, and data-class checks are re-evaluated.
15. **Perform end-to-end test** — only after every preceding step passes, run
    the existing authenticated end-to-end path with a safe read/search action.
    Do not perform forbidden automatic actions.

## Failure handling

Provider failures must follow the existing path:

```text
provider failure
  → deterministic failure classification
  → advisory recovery policy
  → sanitized operational event
  → health/operations reporting
```

Authentication, authorization, approval, capability, data-integrity, and
credit/billing failures are not blindly retried. Rate limits and timeouts may
recommend bounded backoff only when existing idempotency and execution gates
permit it.

Phase 16 reports internal readiness only. It does not claim that the system is
live, does not represent business success, and does not execute external
actions automatically.
