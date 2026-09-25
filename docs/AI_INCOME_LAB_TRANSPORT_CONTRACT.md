# AIAgent → AI Income Lab transport contract (REQUIRED, NOT YET IMPLEMENTED)

Status: **documented interface only. No transport exists in this repository.**

This file records what a real cross-repository handoff must satisfy. It
deliberately defines **no** endpoint URL, route, queue, webhook or credential:
none of those have been agreed with the AI Income Lab project, and inventing
them here would create a fake integration. Nothing in AIAgent calls out to
another service today.

## What exists today

- `src/lib/handoff.ts` defines the versioned in-repository contract type
  `OpportunityHandoffContract` (`contractVersion: 1`) and builds it.
- `src/lib/server/handoff-service.ts` persists handoffs and, on acceptance,
  creates a **local** experiment.
- `src/app/api/handoffs/[id]/execute` runs an **AIAgent-local** agent task.
  It does not contact any other repository or service.
- `POST /api/discovery/candidates/[id]/handoff` prepares a contract and states
  explicitly: *"AI Income Lab actions are not executed by AIAgent."*

So a handoff currently stops at a JSON contract persisted in AIAgent.

## Eligibility is now single-sourced

Handoff eligibility is decided by exactly one policy in `src/lib/handoff.ts`:

- `HANDOFF_IMPLEMENTATION_PERMITTED_CONCLUSIONS` — `VALIDATED`,
  `REQUIRES_HUMAN_REVIEW`. `PROMISING` is **not** permitted.
- `evaluateHandoffGate(facts)` — the one gate.
- `evaluateResearchHandoffReadiness(...)` — the discovery projection of the
  same gate.

Any future transport must consume `OpportunityHandoffContract` and must not
re-derive eligibility locally, or the two repositories can drift again.

## Requirements for a real transport

A future implementation must satisfy all of the following. These are
requirements, not a design that has been built.

1. **Versioned payload.** Deliver `OpportunityHandoffContract` verbatim, with
   `contractVersion` preserved. The receiver must reject an unknown version
   rather than guess.
2. **Authenticated delivery.** Both sides must authenticate the peer. No
   unauthenticated public ingestion endpoint.
3. **Stable idempotency key.** Every delivery carries the handoff id. A retry
   of the same handoff must not create a second downstream experiment. This is
   the same invariant enforced locally in HIGH-4
   (`Experiment.handoffId` unique + a conditional `ACCEPTED → COMPLETED`
   claim).
4. **Durable delivery state.** Delivery status must be persisted (attempted,
   delivered, failed, retried) so a crash cannot silently drop a handoff.
5. **Bounded retries with backoff.** A failure must never be reported as a
   successful handoff.
6. **Contract tests across both repositories.** Producer payload validated
   against the consumer schema in CI.
7. **Explicit configuration.** The receiving endpoint address and its
   credentials must be supplied as environment variables at deploy time. They
   are not, and must not be, committed to either repository.

## Out of scope until the interface is agreed

- Choosing HTTP, a queue or a webhook.
- Inventing an AI Income Lab route.
- Adding AIAgent environment variables for a service that does not exist.

Until a real receiver contract is agreed, handoffs remain an in-repository
data boundary, and the UI continues to say so.
