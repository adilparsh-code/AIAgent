import "server-only";
import type { IntegrationCapability } from "@/lib/integrations/contract";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import { buildExperimentDesign, assessExperimentReadiness, type ExperimentReadinessResult } from "@/lib/experiment-design";
import { getOpportunityDecision } from "@/lib/server/opportunity-decision-service";
import { getOpportunityReadiness } from "@/lib/server/opportunity-readiness-service";
import { getPrisma } from "@/lib/db";

export interface ExperimentReadinessServiceInput {
  hypothesis?: string;
  objective?: string;
  successMetric?: Parameters<typeof buildExperimentDesign>[0]["successMetric"];
  measurementWindow?: { from: string; to: string };
  expectedObservation?: string;
  allowedCapability?: IntegrationCapability;
  baseline?: { value: number; source: string; measuredAt: string };
  dataClass?: "REAL_DATA" | "ESTIMATED_DATA" | "UNKNOWN";
}

export async function getExperimentReadiness(
  experimentId: string,
  ownerId: string,
  input: ExperimentReadinessServiceInput,
): Promise<{ design: ReturnType<typeof buildExperimentDesign>; readiness: ExperimentReadinessResult } | null> {
  const prisma = getPrisma();
  const experiment = await prisma.experiment.findFirst({
    where: { id: experimentId, opportunity: { ownerId }, isSample: false },
    select: { id: true, opportunityId: true, hypothesis: true, objective: true, status: true },
  });
  if (!experiment) return null;

  const [decision, readiness, activations, metricRows, tasks] = await Promise.all([
    getOpportunityDecision(experiment.opportunityId, ownerId),
    getOpportunityReadiness(experiment.opportunityId, ownerId),
    getProviderActivations().catch(() => []),
    prisma.experimentMetric.findMany({ where: { experimentId: experiment.id }, select: { dataClass: true, source: true } }),
    prisma.agentTask.findMany({ where: { experimentId: experiment.id, ownerId }, select: { approvalState: true, requiresApproval: true, status: true, experimentId: true } }),
  ]);
  if (!decision || !readiness) return null;

  const measurementAvailable = metricRows.some((row) => row.dataClass === "REAL_DATA" && row.source.trim().length > 0);
  const capability = input.allowedCapability ?? "READ_DATA";
  const provider = activations.find((candidate) => candidate.status === "HEALTHY" && candidate.capabilities.includes(capability));
  const approved = tasks.some((task) => !task.requiresApproval || task.approvalState === "APPROVED");
  const activeExecution = tasks.some((task) => ["QUEUED", "RUNNING"].includes(task.status));
  const designResult = buildExperimentDesign({
    opportunityId: experiment.opportunityId,
    hypothesis: input.hypothesis ?? experiment.hypothesis,
    objective: input.objective ?? experiment.objective,
    successMetric: input.successMetric ?? { name: "conversions", unit: "COUNT", direction: "HIGHER_IS_BETTER", sourceRequirement: "Source-backed measurement record with period and source." },
    measurementWindow: input.measurementWindow ?? { from: new Date(0).toISOString(), to: new Date(0).toISOString() },
    expectedObservation: input.expectedObservation ?? "An expected observation must be specified before execution; it is not a result.",
    allowedCapability: capability,
    baseline: input.baseline,
    dataClass: input.dataClass ?? (measurementAvailable ? "REAL_DATA" : "UNKNOWN"),
    measurementAvailable,
  });
  if (!designResult.ok) {
    return {
      design: designResult,
      readiness: {
        ready: false,
        state: "NOT_READY",
        blockers: designResult.errors,
        missing: designResult.errors,
        approvalRequired: false,
        nextAction: "Provide a complete, ordered experiment design before execution.",
        explanations: designResult.errors,
      },
    };
  }
  const readinessResult = assessExperimentReadiness({
    design: designResult.design,
    opportunityDecision: decision,
    opportunityReadiness: readiness,
    providerReady: Boolean(provider),
    providerReason: provider ? "A real healthy provider check was recorded." : "No verified provider health check is available for the requested capability.",
    capabilityAuthorized: Boolean(provider),
    capabilityReason: provider ? "Provider declares the requested capability." : "Provider capability is not verified.",
    approvalGranted: approved,
    measurementAvailable,
    idempotencyAvailable: !activeExecution,
    stopConditionsConfigured: designResult.design.stopConditions.length > 0,
    experimentStatus: experiment.status,
    duplicateExecution: activeExecution,
  });
  return { design: designResult, readiness: readinessResult };
}
