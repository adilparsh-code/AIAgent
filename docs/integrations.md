# Integrations & live execution guide

Phase 8 introduced the provider-agnostic adapter framework; Phase 9 adds one
real, safe, measurable end-to-end execution path. This page is the operational
guide for the Integrations control center.

## Control center

`/integrations` — one card per provider with status, environment, capabilities,
missing variable **names**, and the last health check.

Two actions:

- **Run health check** (`POST /api/integrations/:id/health`) — performs a real
  network/authentication probe and persists `IntegrationHealth`.
- **Run test execution** (`POST /api/integrations/:id/test-execution`) — runs
  one real, allowlisted, zero-cost provider action with strict limits.

`/integrations/[id]` — configuration, the safe test-action picker, the test
result (status, data class, latency, sanitized error, execution id, artifact
id), and the tenant's execution history.

### Status semantics

| Status | Meaning |
| --- | --- |
| `NOT_CONFIGURED` | Required variables absent; no connection attempted. |
| `CONFIGURED` | Variables present, no successful probe yet — **not** healthy. |
| `HEALTHY` | A real probe just succeeded. |
| `DEGRADED` | Reachable/authenticated but throttled or partially available. |
| `AUTH_FAILED` | A real probe ran and authentication was rejected. |
| `FAILED` | A real probe ran and failed for a non-auth reason. |
| `DISABLED` | Explicitly disabled by configuration. |

## Data classes — what a number actually is

| Class | Meaning |
| --- | --- |
| `REAL_DATA` | An actual measurement returned by a live provider. |
| `AI_GENERATED` | Model output (drafts, reports). Never a measurement. |
| `ESTIMATED_DATA` | An explicit human/analyst estimate. |
| `SAMPLE_DATA` | Demo rows or a `DRY_RUN` simulation. |

Missing metrics are stored as `NULL` end to end and are never coerced to zero.
CTR, conversion rate, profit, ROI, CPC, CPL, CPA, and revenue-per-visit remain
calculated from recorded rows by the existing Phase 6B aggregation.

## Safe execution rules

Test executions and task executions share one orchestrator, so the same gates
apply:

1. **Ownership** — the session user owns the task; cross-tenant access is
   404-masked.
2. **Allowlist** — the action must exist in `TASK_TYPE_ACTIONS` for the task
   type. The provider is chosen by the operator, never by model output.
3. **Capability + approval** — `PUBLISH`, `SEND_MESSAGE`, `CREATE_CAMPAIGN`,
   `SPEND_MONEY`, and `UPLOAD` require explicit owner approval and are not
   reachable from the test-execution endpoint at all.
4. **Idempotency** — one row per (owner, task, integration, action, mode);
   duplicate requests resolve to the existing execution.
5. **Bounded retries** — only `SERVER`/`NETWORK`/`RATE_LIMIT` failures retry,
   never approval-class or irreversible actions; test executions allow a single
   attempt.
6. **Untrusted content** — external text is wrapped as data before it can reach
   a prompt; it can never become an instruction.
7. **Secrets** — server-side only; never persisted, logged, returned, or sent to
   a model.

## Live test mode

```
POST /api/integrations/sambanova/test-execution
{ "action": "GENERATE_TEXT", "requestId": "ui-click-123" }
```

The objective is a fixed deterministic probe — client input never becomes a
provider instruction. Limits: 60s, 2 000 output chars, 1 attempt, 1 action,
budget `0`. A repeated `requestId` returns the same execution instead of
issuing a second provider call.

## AI Income Lab bridge

```
Validated opportunity → handoff READY → accepted → experiment
  → AgentTask (budget 0) → provider call
  → AgentExecution + IntegrationExecution + AgentArtifact
  → ExperimentMetric (only real measurements)
  → evaluation + learning feedback
  → optional manual rerank
```

`POST /api/handoffs/:id/execute` runs the safe step of that chain. It never
moves money, never launches campaigns, and never re-ranks automatically —
Phase 6C bounded reranking stays a manual action.

## Audit trail

Every live execution is reconstructable:

`User → AgentTask → Integration (health/config) → Approval → AgentExecution →
IntegrationExecution → AgentArtifact → Experiment → ExperimentMetric`

Only operational metadata and final outputs are stored — never
chain-of-thought, never secrets.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NOT_CONFIGURED` | Required variable missing | Set it in Settings → Environment (server-side only). |
| `AUTH_FAILED` on health check | Key rejected (401/403) | Replace the key; for Reddit this is usually a datacenter-IP block. |
| `DEGRADED` | Provider throttling (429) | Wait and re-check; test executions do not hammer. |
| Execution `UNAVAILABLE` | Adapter has no credentials | Configure the provider, then re-run the health check. |
| Execution `FAILED` with sanitized error | Provider/transport failure | Check the health check result and the error summary on the execution. |
| `WAITING_APPROVAL` on the task | Approval-class action | Approve explicitly — or use a safe action instead. |

## Phase 15 activation readiness

`GET /api/integrations/activation` is an authenticated, bounded, read-only
metadata endpoint. It does not run a health check, call a provider, or return
secret values. The `ProviderActivationPanel` on `/integrations` displays the
same safe state.

The activation state machine is intentionally conservative:

- configuration present without a real health check is
  `READY_FOR_HEALTH_CHECK`, never `HEALTHY`;
- a real health check can produce `HEALTHY`, `DEGRADED`, `AUTH_FAILED`,
  `CREDIT_LIMITED`, `RATE_LIMITED`, or `UNAVAILABLE`;
- credit/billing failures are non-retryable and never trigger spending;
- write-side capabilities stop at `LIVE_WRITE_TEST_REQUIRES_APPROVAL`;
- `PUBLISH`, `SEND_MESSAGE`, `CREATE_CAMPAIGN`, and `SPEND_MONEY` remain
  approval-gated through the existing capability contract.

The activation plan is generated from existing integration capabilities and
health/execution contracts. It does not create a second source of truth.

## Phase 17 controlled activation and first research cycle

Phase 17 wraps the existing registry and execution orchestrator with three
authenticated operations:

- `POST /api/integrations/{id}/activate` — one real health check, persisted in
  `IntegrationHealth`, with sanitized operational events.
- `POST /api/integrations/{id}/live-test` — one allowlisted safe read/search or
  draft action through the existing AgentTask, `AgentExecution`, and
  `IntegrationExecution` path. It accepts a bounded `requestId` for idempotency.
- `POST /api/research/live-cycle` — owner-scoped opportunity research. It first
  health-checks the selected existing research providers, then calls the existing
  `runResearch` and `researchRepository.save` contracts. The existing decision
  pipeline is recomputed after persistence.

`src/lib/integrations/live-activation-controller.ts` is deterministic around
configuration, health, capability, approval, and execution gates. Its injected
server adapter uses the existing services rather than bypassing them. Every
attempt emits the Phase 14 operational event model and sanitized structured
logging; raw provider output and headers are not returned.

### Normalization and REAL_DATA

`live-provider-normalization.ts` maps provider outcomes to safe metadata:
provider, operation, success/status, latency, result count, sanitized error,
data class, request ID, and execution ID. It handles success, authentication,
credit/billing, rate limiting, timeout, unavailable, malformed, empty, and
validation outcomes. Credit failures are non-retryable.

`real-data-integrity.ts` is the evidence gate. A live observation is not
`REAL_DATA` without a real successful provider health check, provider/source,
valid source URL, observation timestamp, current research-run relationship, and
evidence identity. Missing provenance downgrades the claim; it never fabricates
a source or upgrades `SAMPLE_DATA`, `AI_ESTIMATE`, or `ESTIMATED_DATA`.

### Failure and safety behavior

`AUTH_FAILED` requires human review/configuration correction. `CREDIT_LIMITED`
requires human review and never retries or spends. `RATE_LIMITED` and timeout
return the existing bounded backoff recommendation. Malformed/empty responses
require validation/research again. Data-integrity failures stop or refresh state.
No failure is silently converted to success. Approval, ownership, capability,
and execution-state checks remain authoritative.

The first live cycle is safe only for read/search operations. Publish, messaging,
campaign creation, uploading, and spending are not automatically executable;
write-side live tests return `LIVE_WRITE_TEST_REQUIRES_APPROVAL`.
