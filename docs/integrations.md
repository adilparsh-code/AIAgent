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
