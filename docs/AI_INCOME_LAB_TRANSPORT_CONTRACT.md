# AIAgent → AI Income Lab transport contract

Status: **shared contract IMPLEMENTED. Producer IMPLEMENTED. Network delivery NOT LIVE.**

The cross-repository handoff boundary is now specified as code on both sides of
the same definition, and AIAgent has a real, authenticated, bounded delivery
path. What does **not** exist — and is not faked — is an addressable AI Income
Lab receiver: the repository at `adilparsh-code/ai-income-lab` exposes no
inbound handoff ingestion endpoint at its current `main`, so no delivery has
ever crossed a network boundary. Until an operator configures a real receiver,
every delivery attempt is recorded as `NOT_CONFIGURED`.

## What was implemented

| Piece | Location | Status |
| --- | --- | --- |
| Shared versioned contract (producer + receiver validator) | `src/lib/handoff-delivery/contract.ts` | Implemented, unit-tested |
| Producer transport (auth, timeout, bounded retry, error semantics) | `src/lib/handoff-delivery/transport.ts` | Implemented, unit-tested |
| Durable delivery state / delivery audit trail | `prisma` model `HandoffDelivery` | Implemented, migrated |
| Producer service (authz, owner scoping, self-check, audit) | `src/lib/server/handoff-delivery-service.ts` | Implemented |
| Owner-scoped delivery endpoint | `POST/GET /api/handoffs/:id/deliver` | Implemented |
| **Receiver endpoint in AI Income Lab** | — | **Does not exist. Not faked.** |
| **Live network delivery** | — | **NOT LIVE — no receiver, no credentials** |

## The contract

`contractId: "aiagent.income-lab.opportunity-handoff"`, `contractVersion: 1`.

An envelope carries:

- **contract version and identity** — `contractId`, `contractVersion`; an
  unknown value is refused, never guessed;
- **handoff id** — AIAgent's handoff id, the receiver's natural foreign key;
- **source system / target system** — `AIAGENT` → `AI_INCOME_LAB`;
- **source opportunity id** — the opportunity in AIAgent the handoff came from;
- **opportunity data required downstream** — title, category, target audience,
  problem, monetization methods, risks;
- **validation / decision state** — research conclusion, confidence, score,
  handoff status, and AIAgent's `eligibleForImplementation` verdict;
- **evidence references** — bounded `{evidenceId, source, url, title, supports}`
  entries. Full evidence rows never leave AIAgent;
- **experiment proposal** — recommended type, hypothesis, success criteria,
  budget limit, time limit. A *proposal*: delivery never triggers execution;
- **idempotency / delivery key** — `aiagent-handoff:<handoffId>:v<version>`,
  deterministic, so a retry is recognised as the same logical delivery;
- **timestamp** — `issuedAt`.

### Authentication expectations

- **Transport:** `Authorization: Bearer <AI_INCOME_LAB_HANDOFF_TOKEN>`, sent by
  AIAgent, validated by the receiver. The credential is never logged and never
  written to the delivery audit trail.
- **Endpoint:** the receiver must be reachable over **HTTPS only**. A plaintext
  or non-absolute endpoint is treated as not configured (fail closed).
- **Inside AIAgent:** `POST /api/handoffs/:id/deliver` requires a session
  (`requireUser`) and owner-scoped access to the handoff. A foreign handoff
  answers `404`, exactly like a missing one.

### Delivery status and error semantics

`NOT_CONFIGURED | PENDING | DELIVERED | REJECTED | FAILED`, plus
`NOT_CONFIGURED → HTTP 503` from the delivery endpoint.

| Receiver answer | AIAgent code | Retried? |
| --- | --- | --- |
| 2xx | — (`DELIVERED`, `duplicate` reported if the receiver says so) | n/a |
| 401 / 403 | `AUTH_REJECTED` | no |
| 400 with an unsupported version | `UNSUPPORTED_VERSION` | no |
| 400 / 422 otherwise | `INVALID_PAYLOAD` | no |
| 429 | `RATE_LIMITED` | yes |
| 5xx | `RECEIVER_UNAVAILABLE` | yes |
| attempt exceeded the timeout | `TIMEOUT` | yes |
| transport failure | `NETWORK_ERROR` | yes |

Retries are bounded (3 attempts) with exponential backoff capped at 8s. A
refusal by the receiver is a decision, not a transient fault, so it is never
retried. A failure is never reported as a successful handoff.

## Required safeguards, and where they live

| Safeguard | Where |
| --- | --- |
| Authentication | `transport.ts` (bearer credential, fail-closed config) |
| Authorization | `handoff-delivery-service.ts` + `requireUser` on the route |
| Owner / tenant isolation | `handoffRepository.getById(id, ownerId)`; foreign = 404 |
| Idempotency | `handoffDeliveryKey` + unique `HandoffDelivery.idempotencyKey` |
| Duplicate-delivery protection | same key on both sides; receiver validator refuses a mismatch |
| Timeout | `AbortController` per attempt, bounded and configurable |
| Bounded retry | `HANDOFF_DELIVERY_MAX_ATTEMPTS` + capped backoff |
| Failure state | `HandoffDelivery.status` ∈ `REJECTED`/`FAILED`/`NOT_CONFIGURED` |
| Delivery audit trail | `HandoffDelivery` row per handoff, upserted on every attempt |
| No secret leakage | credential never persisted; error messages are fixed strings, not response bodies |
| No uncontrolled execution | delivery requires `ACCEPTED` + implementation-eligible conclusion, and performs no downstream action itself |

## Eligibility stays single-sourced

The envelope carries AIAgent's verdict; it never re-derives it. The gate lives
only in `src/lib/handoff.ts`:

- `HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS` — `VALIDATED`,
  `REQUIRES_HUMAN_REVIEW`. `PROMISING` is **not** permitted.
- `evaluateHandoffGate(facts)` — the one gate.
- `evaluateResearchHandoffReadiness(...)` — the discovery projection.

`deliverHandoff` refuses a handoff whose persisted conclusion is not
implementation-permitted, so a transport can never become a way around the
gate.

## What the AI Income Lab repository currently provides

Verified at `adilparsh-code/ai-income-lab` `main` (`61dd988`):

- `src/lib/agents/coordination.ts` defines an `AgentHandoff` — an in-process
  agent-to-agent context record (`sourceAgent`, `relevantFacts`, `hypotheses`,
  `unresolvedQuestions`). It is **not** an inbound ingestion contract and is not
  compatible with `OpportunityHandoffContract`.
- There is **no** handoff ingestion route, **no** experiment-ingestion endpoint
  and **no** external-caller contract for AIAgent.
- The nearest existing pattern is the Ruflo runtime API
  (`src/lib/ruflo/runtime.ts`): a bearer shared secret verified in constant
  time, a per-credential throttle, a strict body guard, and workflow-level
  idempotency. That is the pattern a receiver here should follow.
- AI Income Lab is single-tenant today (no `userId`/owner column on
  `Opportunity`), so a receiver would additionally have to decide, explicitly,
  which local owner an inbound handoff belongs to. That is an AI Income Lab
  product decision and has not been made.

## To make delivery live

1. Implement the receiver in AI Income Lab against
   `parseHandoffDeliveryEnvelope` (the same definition, ported or shared).
   Require the bearer credential, de-duplicate on `idempotencyKey`, and apply
   the system's own human-review gate before anything executes.
2. Set `AI_INCOME_LAB_HANDOFF_ENDPOINT` (absolute `https://` URL) and
   `AI_INCOME_LAB_HANDOFF_TOKEN` (≥ 32 characters) in AIAgent's deployment
   environment. Both are server-side only and are **not** committed anywhere.
3. Optionally set `AI_INCOME_LAB_HANDOFF_TIMEOUT_MS` (1 000 – 60 000).
4. `GET /api/handoffs/:id/deliver` then reports the capability and the real
   outcome of the last attempt.

Until all of that exists and a delivery has actually been observed by a real
receiver, cross-repository transport is **NOT LIVE**.
