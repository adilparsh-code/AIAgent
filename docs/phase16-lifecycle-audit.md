# Phase 16 lifecycle audit

This is an audit of the existing AIAgent lifecycle, not a new workflow or a
second source of truth. All stages remain tenant-scoped through the existing
authentication, ownership, approval, capability, idempotency, and data-class
contracts.

| Stage | Input | Output | Owner/security boundary | Persistence | Failure behavior | Next stage | Missing dependency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Discovery | Topic/category and bounded candidate request | Ranked candidate hypotheses | Authenticated owner; no provider execution | `DiscoveryRun`, `DiscoveryCandidate`, linked `Opportunity` | Missing configuration is explicit; no fake candidates are promoted | Research | Real provider activation remains optional and pending until configured/tested |
| Research | Owned opportunity and bounded queries | `ResearchRun`, sources, findings, errors | Session identity and opportunity ownership | Transactional `ResearchRun` tree | Provider unavailable, timeout, rate limit, malformed/empty response is classified; no fabricated evidence | Evidence | Real provider health and safe read/search verification |
| Evidence | Provider responses and source metadata | Sanitized, deduplicated `Evidence` with source/data class | Provider content is untrusted data; secrets never enter evidence | `ResearchSource`, `Evidence` with unique run/hash protection | Invalid or unusable rows are dropped or fail safely; contradictions remain visible | Validation | Provider response schemas and real health checks |
| Validation | Evidence IDs, coverage, diversity, contradictions | `Validation` signals and conclusion | Owned opportunity; no sample/user mix | `Validation` and research JSON | Insufficient/conflicting evidence yields honest review/insufficient states | Scoring | Real-data coverage is still pending until providers run |
| Scoring | Validation, confidence, existing scoring factors | Score and research-informed guidance | Advisory only; no external action | Opportunity research metadata and brief | Missing evidence leaves factors unchanged or review-required | Research intelligence | No provider is assumed healthy from configuration |
| Research intelligence | Persisted research/validation metadata | Bounded evidence-backed intelligence and review flags | Owner-scoped bounded loader | Existing opportunity/research read models | Contradictions and insufficiency remain warnings; no invented evidence | Readiness | Live provider data is optional, not fabricated |
| Readiness | Owner opportunity, validation, research, and metrics state | Readiness decision and missing prerequisites | Owner-scoped read; sample data excluded | Existing readiness/decision read path | `HUMAN_REVIEW`, conflict, or insufficient data remains non-ready | Decision | A real provider activation is still pending |
| Decision | Readiness result and bounded decision inputs | `HUMAN_REVIEW`/advisory decision | Advisory, owner-scoped; no execution bypass | Existing decision snapshot/cache | Conflict/insufficient data routes to review; never auto-executes | Portfolio | Approval and execution remain separate gates |
| Portfolio | Owner decisions, experiments, and bounded metrics | Portfolio ranking and concentration/review signals | Owner-scoped bounded aggregation; no N+1 | Existing portfolio/learning snapshots | Missing metrics and warnings remain explicit; no business-success claim | Experiment prioritization | Real measurement coverage is pending |
| Experiment prioritization | Portfolio ranking and experiment state | Prioritized experiment decisions | Owner-scoped; data class preserved | Experiment and learning records | Insufficient data cannot become a win or validated result | Operating loop | Real `ExperimentMetric` observations require safe execution |
| Operating loop | Owner opportunity/portfolio/experiment state | Bounded next actions and human-review queue | Existing autonomous loop; no automatic external side effects | Existing loop/decision records | Provider, approval, capability, or execution failure stops/backs off safely | Learning | Live provider activation and live test are pending |
| Learning | Completed/insufficient experiment outcomes and real metrics | Feedback, learning delta, rerank input | Owner-scoped; only recorded data affects learning | `ExperimentMetric`, learning snapshots, feedback | Missing/estimated-only data cannot move ranking as real validation | Handoff / portfolio | Real provider measurement remains pending |
| Handoff | Eligible validated opportunity and contract | `Handoff` contract and lifecycle state | Eligibility, owner, and explicit acceptance gates | `Handoff` with lifecycle persistence | Rejected/ineligible opportunities are not handed off; conflicts stop safely | Execution | No automatic external action at handoff |
| Execution | Owned `AgentTask`, capability decision, approval state, idempotency key | `AgentExecution`, `IntegrationExecution`, artifact | Authentication → ownership → approval → capability → execution state | Idempotent execution rows and sanitized audit output | Auth, credit, approval, capability, duplicate, and terminal failures are not blindly retried | Measurement | Real provider configuration and safe live test |
| Measurement | Successful measurable provider result and experiment context | `ExperimentMetric` with original data class | Owner-scoped bridge; only `REAL_DATA` measurements are accepted | Unique period/source metric records | Missing values remain null; duplicate ingestion is rejected | Reassessment | Real provider measurement is pending |
| Reassessment / portfolio | Metrics, experiment result, learning feedback | Updated decision and portfolio view | Owner-scoped bounded read/learning path | Existing learning and portfolio snapshots | Insufficient/conflicting data remains visible and non-final | Next portfolio cycle | No claim of live or business readiness without real data |

## Contract compatibility result

The existing contracts align across field names, statuses, ownership,
approval, capability, idempotency, and data-class boundaries. Phase 16 did not
identify a reason to add a schema migration or duplicate pipeline. The only
intentional launch-gate additions are read-only readiness metadata; they do not
become a second persistence or execution source.

## Security audit result

Sensitive operations continue to require the existing ordered boundaries:
authentication, ownership, task approval, capability permission, integration
permission, and execution state. `PUBLISH`, `SEND_MESSAGE`, `CREATE_CAMPAIGN`, and
`SPEND_MONEY` remain approval-gated and are never automatic launch actions.

## Failure-path result

Research/provider, database, validation, experiment, execution, duplicate,
approval, timeout, rate-limit, and credit/billing failures have safe
classification and recovery recommendations. Existing operational events and
health/operations reporting remain the observability path; no failure is
silently converted into success.

## Data-class result

`REAL_DATA`, `SAMPLE_DATA`, `ESTIMATED_DATA`, and `UNKNOWN` remain distinct.
The audit found no path in the launch model that upgrades sample, estimated,
or unknown values to real-world validation.
