import type { IntegrationCapability } from "./integrations/contract";
import { capabilityRequiresApproval } from "./integrations/contract";
import type { OpportunityDecision } from "./opportunity-decision";
import type { OpportunityReadiness } from "./opportunity-readiness";

export const EXPERIMENT_DESIGN_VERSION = 1 as const;

export type ExperimentDataClass = "REAL_DATA" | "ESTIMATED_DATA" | "UNKNOWN";
export type ExperimentBaseline =
  | { status: "MEASURED"; value: number; dataClass: "REAL_DATA"; source: string; measuredAt: string }
  | { status: "NOT_MEASURED"; value: null; dataClass: "NOT_MEASURED"; source: null; measuredAt: null };

export interface ExperimentMetricDefinition {
  name: string;
  numerator?: string;
  denominator?: string;
  unit: "COUNT" | "CURRENCY" | "RATE" | "DURATION";
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  sourceRequirement: string;
}

export interface ExperimentDesign {
  version: typeof EXPERIMENT_DESIGN_VERSION;
  hypothesis: string;
  opportunityId: string;
  objective: string;
  successMetric: ExperimentMetricDefinition;
  measurementWindow: { from: string; to: string };
  /** Expected observation is a hypothesis, never an observed result. */
  expectedObservation: { description: string; isMeasuredResult: false };
  baseline: ExperimentBaseline;
  allowedCapability: IntegrationCapability;
  approvalRequired: boolean;
  stopConditions: string[];
  dataClass: ExperimentDataClass;
  provenanceRequirements: string[];
  measurementStatus: "AVAILABLE" | "NOT_MEASURED";
}

const DEFAULT_STOP_CONDITIONS = [
  "PROVIDER_UNAVAILABLE",
  "AUTH_FAILED",
  "CREDIT_LIMITED",
  "RATE_LIMITED",
  "REPEATED_TIMEOUT",
  "APPROVAL_REVOKED",
  "CAPABILITY_INVALID",
  "DUPLICATE_EXECUTION",
  "MEASUREMENT_INVALID",
  "SAFETY_VIOLATION",
] as const;

function text(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validWindow(value: unknown): value is { from: string; to: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { from?: unknown; to?: unknown };
  if (typeof candidate.from !== "string" || typeof candidate.to !== "string") return false;
  const from = Date.parse(candidate.from);
  const to = Date.parse(candidate.to);
  return Number.isFinite(from) && Number.isFinite(to) && to > from;
}

/** Build a design without inventing a baseline or treating expectations as results. */
export function buildExperimentDesign(input: {
  opportunityId: string;
  hypothesis: string;
  objective: string;
  successMetric: ExperimentMetricDefinition;
  measurementWindow: { from: string; to: string };
  expectedObservation: string;
  allowedCapability: IntegrationCapability;
  baseline?: { value: number; source: string; measuredAt: string };
  stopConditions?: string[];
  dataClass?: ExperimentDataClass;
  measurementAvailable: boolean;
}): { ok: true; design: ExperimentDesign } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!text(input.opportunityId, 64)) errors.push("opportunityId is required");
  if (!text(input.hypothesis, 1_000)) errors.push("hypothesis is required");
  if (!text(input.objective, 600)) errors.push("objective is required");
  if (!text(input.expectedObservation, 600)) errors.push("expectedObservation is required");
  if (!validWindow(input.measurementWindow)) errors.push("measurementWindow must have an ordered ISO period");
  if (!text(input.successMetric?.name, 120) || !text(input.successMetric?.unit, 32) || !text(input.successMetric?.sourceRequirement, 300)) {
    errors.push("successMetric requires name, unit, direction, and sourceRequirement");
  }
  const baseline: ExperimentBaseline = input.baseline && text(input.baseline.source, 120)
    ? {
        status: "MEASURED",
        value: input.baseline.value,
        dataClass: "REAL_DATA",
        source: text(input.baseline.source, 120),
        measuredAt: input.baseline.measuredAt,
      }
    : { status: "NOT_MEASURED", value: null, dataClass: "NOT_MEASURED", source: null, measuredAt: null };
  if (errors.length) return { ok: false, errors };
  const approvalRequired = capabilityRequiresApproval(input.allowedCapability);
  const design: ExperimentDesign = {
    version: EXPERIMENT_DESIGN_VERSION,
    hypothesis: text(input.hypothesis, 1_000),
    opportunityId: text(input.opportunityId, 64),
    objective: text(input.objective, 600),
    successMetric: input.successMetric,
    measurementWindow: input.measurementWindow,
    expectedObservation: { description: text(input.expectedObservation, 600), isMeasuredResult: false },
    baseline,
    allowedCapability: input.allowedCapability,
    approvalRequired,
    stopConditions: [...new Set([...(input.stopConditions ?? []), ...DEFAULT_STOP_CONDITIONS])].map((item) => text(item, 120)).filter(Boolean),
    dataClass: input.dataClass ?? "UNKNOWN",
    provenanceRequirements: [
      "A real baseline requires source, collection time, and measurement period.",
      "Execution success is not an experiment result.",
      "Only source-backed metric rows may be classified REAL_DATA.",
    ],
    measurementStatus: input.measurementAvailable ? "AVAILABLE" : "NOT_MEASURED",
  };
  return { ok: true, design };
}

export interface ExperimentReadinessInput {
  design: ExperimentDesign;
  opportunityDecision: OpportunityDecision;
  opportunityReadiness: OpportunityReadiness;
  providerReady: boolean;
  providerReason: string;
  capabilityAuthorized: boolean;
  capabilityReason: string;
  approvalGranted: boolean;
  measurementAvailable: boolean;
  idempotencyAvailable: boolean;
  stopConditionsConfigured: boolean;
  experimentStatus: string;
  duplicateExecution: boolean;
}

export interface ExperimentReadinessResult {
  ready: boolean;
  state: "READY" | "NOT_READY" | "BLOCKED";
  blockers: string[];
  missing: string[];
  approvalRequired: boolean;
  nextAction: string;
  explanations: string[];
}

function validExperimentStatus(status: string): boolean {
  return ["PLANNED", "READY", "RUNNING", "ACTIVE", "PAUSED", "ITERATING"].includes(status);
}

/** Gate every experiment transition before an execution is allowed. */
export function assessExperimentReadiness(input: ExperimentReadinessInput): ExperimentReadinessResult {
  const blockers: string[] = [];
  const missing: string[] = [];
  const add = (condition: boolean, blocker: string, gap = blocker) => {
    if (!condition) { blockers.push(blocker); missing.push(gap); }
  };
  add(input.opportunityDecision.decision !== "BLOCKED", "Opportunity decision is BLOCKED");
  add(input.opportunityReadiness.readinessState !== "BLOCKED", "Opportunity readiness is BLOCKED");
  add(!input.opportunityReadiness.staleResearch, "Research is stale", "Fresh research");
  add(input.opportunityReadiness.experimentReadiness.realMetricPeriods > 0 || !input.opportunityReadiness.contradictions.length, "No source-backed real baseline/measurement is available and evidence is contradictory", "Real measurement or contradiction resolution");
  add(input.providerReady, input.providerReason, "Verified provider readiness");
  add(input.capabilityAuthorized, input.capabilityReason, "Capability authorization");
  add(input.measurementAvailable && input.design.measurementStatus === "AVAILABLE", "Measurement source is unavailable", "Source-backed measurement");
  add(input.idempotencyAvailable, "Idempotency key is unavailable", "Execution idempotency");
  add(input.stopConditionsConfigured && input.design.stopConditions.length > 0, "Stop conditions are incomplete", "Stop/rollback conditions");
  add(!input.duplicateExecution, "Duplicate execution detected");
  add(validExperimentStatus(input.experimentStatus), `Experiment status ${input.experimentStatus} cannot be started`, "Valid experiment lifecycle state");
  if (input.design.approvalRequired) add(input.approvalGranted, "Explicit approval is required for the selected capability", "Capability approval");
  const hard = blockers.some((item) => /BLOCKED|Duplicate|approval|capability|provider/i.test(item));
  const ready = blockers.length === 0;
  return {
    ready,
    state: ready ? "READY" : hard ? "BLOCKED" : "NOT_READY",
    blockers,
    missing,
    approvalRequired: input.design.approvalRequired,
    nextAction: ready ? "Execute through the existing owner-scoped execution orchestrator; record measurements separately." : missing[0] ?? "Resolve readiness blockers",
    explanations: [
      `Research: ${input.opportunityReadiness.researchFreshness.kind}; decision: ${input.opportunityDecision.decision}.`,
      `Measurement: ${input.design.measurementStatus}; baseline: ${input.design.baseline.status}.`,
      "Expected observations are not results and never satisfy a measurement gate.",
    ],
  };
}
