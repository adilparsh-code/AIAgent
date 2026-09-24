/**
 * Phase 19 — side-effect-free execution plan contract.
 *
 * Building a plan only validates and describes work. It never calls a
 * provider, creates a task, persists an execution, or implies that a plan was
 * run. The existing execution orchestrator remains the only write/execute
 * boundary.
 */
import { capabilityRequiresApproval, type IntegrationCapability } from "@/lib/integrations/contract";
import { buildIdempotencyKey } from "@/lib/integrations/contract";

export const EXECUTION_PLAN_VERSION = 1 as const;
export const EXECUTION_PLAN_LIMITS = {
  maxSteps: 8,
  maxMeasurementMetrics: 12,
  maxText: 600,
} as const;

export type ExecutionPlanDataClass = "REAL_DATA" | "AI_GENERATED" | "AI_ESTIMATE" | "SAMPLE_DATA" | "ESTIMATED_DATA" | "NOT_MEASURED" | "UNKNOWN";

export interface ExecutionMeasurementPlan {
  metrics: string[];
  sourceRequirement: string;
  availability: "AVAILABLE" | "NOT_MEASURED";
  dataClass: ExecutionPlanDataClass;
  provenanceRequired: boolean;
}

export interface ExecutionPlan {
  version: typeof EXECUTION_PLAN_VERSION;
  opportunityId: string;
  objective: string;
  steps: string[];
  provider: string;
  capability: IntegrationCapability;
  approvalRequired: boolean;
  measurementPlan: ExecutionMeasurementPlan;
  successMetric: string;
  stopConditions: string[];
  rollbackCondition: string;
  dataClass: ExecutionPlanDataClass;
  idempotencyKey: string;
  createdAt: string;
}

export interface ExecutionPlanInput {
  ownerId: string;
  opportunityId: string;
  objective: string;
  steps: string[];
  provider: string;
  capability: IntegrationCapability;
  measurementPlan: {
    metrics: string[];
    sourceRequirement: string;
    availability: "AVAILABLE" | "NOT_MEASURED";
    dataClass: ExecutionPlanDataClass;
    provenanceRequired?: boolean;
  };
  successMetric: string;
  stopConditions: string[];
  rollbackCondition: string;
  dataClass: ExecutionPlanDataClass;
  now?: Date;
}

const DEFAULT_STOPS = [
  "PROVIDER_UNAVAILABLE",
  "AUTH_FAILED",
  "CREDIT_LIMITED",
  "RATE_LIMITED",
  "TIMEOUT",
  "DUPLICATE_EXECUTION",
  "MEASUREMENT_INVALID",
  "APPROVAL_REVOKED",
  "SAFETY_VIOLATION",
];

function text(value: unknown, max: number = EXECUTION_PLAN_LIMITS.maxText): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDataClass(value: unknown): value is ExecutionPlanDataClass {
  return ["REAL_DATA", "AI_GENERATED", "AI_ESTIMATE", "SAMPLE_DATA", "ESTIMATED_DATA", "NOT_MEASURED", "UNKNOWN"].includes(String(value));
}

/** Validate and build a plan. No persistence or external side effect occurs. */
export function buildExecutionPlan(input: ExecutionPlanInput): { ok: true; plan: ExecutionPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const ownerId = text(input.ownerId, 200);
  const opportunityId = text(input.opportunityId, 64);
  const objective = text(input.objective);
  const provider = text(input.provider, 120);
  const steps = Array.isArray(input.steps)
    ? input.steps.map((step) => text(step)).filter(Boolean).slice(0, EXECUTION_PLAN_LIMITS.maxSteps)
    : [];
  const metrics = Array.isArray(input.measurementPlan?.metrics)
    ? input.measurementPlan.metrics.map((metric) => text(metric, 120)).filter(Boolean).slice(0, EXECUTION_PLAN_LIMITS.maxMeasurementMetrics)
    : [];
  const sourceRequirement = text(input.measurementPlan?.sourceRequirement);
  const successMetric = text(input.successMetric, 300);
  const stopConditions = [...new Set([...input.stopConditions.map((item) => text(item, 120)).filter(Boolean), ...DEFAULT_STOPS])].slice(0, EXECUTION_PLAN_LIMITS.maxText);
  const rollbackCondition = text(input.rollbackCondition);

  if (!ownerId) errors.push("ownerId is required");
  if (!opportunityId) errors.push("opportunityId is required");
  if (!objective) errors.push("objective is required");
  if (steps.length === 0) errors.push("at least one execution step is required");
  if (!provider) errors.push("provider is required");
  if (!metrics.length) errors.push("measurementPlan.metrics must not be empty");
  if (!sourceRequirement) errors.push("measurementPlan.sourceRequirement is required");
  if (!successMetric) errors.push("successMetric is required");
  if (!rollbackCondition) errors.push("rollbackCondition is required");
  if (!validDataClass(input.dataClass)) errors.push("dataClass is invalid");
  if (!validDataClass(input.measurementPlan?.dataClass)) errors.push("measurementPlan.dataClass is invalid");
  if (input.measurementPlan?.availability === "AVAILABLE" && input.measurementPlan?.dataClass !== "REAL_DATA") {
    errors.push("AVAILABLE measurement requires source-backed REAL_DATA provenance");
  }
  if (input.dataClass === "REAL_DATA" && input.measurementPlan?.dataClass !== "REAL_DATA") {
    errors.push("REAL_DATA execution data class cannot be paired with non-real measurement data");
  }
  if (errors.length) return { ok: false, errors };

  const capability = input.capability;
  const approvalRequired = capabilityRequiresApproval(capability);
  const plan: ExecutionPlan = {
    version: EXECUTION_PLAN_VERSION,
    opportunityId,
    objective,
    steps,
    provider,
    capability,
    approvalRequired,
    measurementPlan: {
      metrics,
      sourceRequirement,
      availability: input.measurementPlan.availability,
      dataClass: input.measurementPlan.dataClass,
      provenanceRequired: input.measurementPlan.provenanceRequired ?? true,
    },
    successMetric,
    stopConditions,
    rollbackCondition,
    dataClass: input.dataClass,
    idempotencyKey: buildIdempotencyKey({ ownerId, taskId: `plan:${opportunityId}`, adapterName: provider, action: capability }),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  return { ok: true, plan };
}
