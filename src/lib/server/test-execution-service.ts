import "server-only";

import { getPrisma } from "@/lib/db";
import { getIntegrationRegistry, type IntegrationRegistry } from "@/lib/integrations/registry";
import { logger } from "./logger";
import { runAgentTaskExecution, type ExecutionOutcome } from "./execution-orchestrator";
import {
  resolveTestAction,
  resolveTestActions,
  sanitizeRequestId,
  TEST_EXECUTION_LIMITS,
  type TestActionDescriptor,
} from "@/lib/integrations/test-execution";
import type { AgentTaskType } from "@/lib/agent-task";

/**
 * Phase 9 — live test execution service.
 *
 * One real, safe, strictly-bounded provider call per request, executed through
 * the Phase 9A orchestrator so the full audit trail exists:
 *
 *   User → AgentTask → Integration (health/config) → Approval gate
 *        → Provider API → AgentExecution + IntegrationExecution
 *        → AgentArtifact → (measurable only) ExperimentMetric
 *
 * Guarantees:
 * - Only allowlisted, zero-financial-impact actions are testable; approval-class
 *   and irreversible capabilities are never reachable from here.
 * - The provider is never chosen by model output — only by the operator's URL
 *   path, resolved server-side through the registry.
 * - Test prompts are fixed constants; client input cannot become instructions.
 * - A repeat request carrying the same requestId resolves to the same task and
 *   therefore the same execution (no duplicate provider calls).
 * - Secrets never appear in the response, the logs, or the database.
 */

export class TestExecutionError extends Error {
  readonly code: "INTEGRATION_NOT_FOUND" | "NO_SAFE_ACTION" | "ACTION_NOT_ALLOWED" | "SCAFFOLD" | "DB_UNAVAILABLE";
  readonly httpStatus: number;
  constructor(code: TestExecutionError["code"], message: string, httpStatus: number) {
    super(message);
    this.name = "TestExecutionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface TestExecutionResult {
  integration: string;
  action: string;
  capability: string;
  status: string;
  mode: "LIVE" | "DRY_RUN";
  executionId: string | null;
  taskId: string;
  artifactId: string | null;
  dataClass: string | null;
  durationMs: number | null;
  error: string | null;
  outputExcerpt: string | null;
  message: string;
  configured: boolean;
  integrationStatus: string;
  missingEnvVars: string[];
}

/** Task id derived from the client request id keeps duplicate clicks idempotent. */
function testTaskId(requestId: string): string {
  return `test_${requestId}`;
}

function excerpt(output: unknown, maxChars = 600): string | null {
  if (output === null || output === undefined) return null;
  const raw = typeof output === "string" ? output : JSON.stringify(output);
  if (!raw) return null;
  return raw.slice(0, maxChars);
}

/**
 * Run one safe test execution. Never throws for provider failures — a failed
 * call is a recorded, honest outcome, not an exception.
 */
export async function runTestExecution(input: {
  integrationName: string;
  ownerId: string;
  action?: string;
  requestId: string;
  mode?: "LIVE" | "DRY_RUN";
  registry?: IntegrationRegistry;
  experimentId?: string | null;
  opportunityId?: string | null;
}): Promise<TestExecutionResult> {
  const registry = input.registry ?? getIntegrationRegistry();
  const adapter = registry.resolve(input.integrationName);
  if (!adapter) {
    throw new TestExecutionError("INTEGRATION_NOT_FOUND", "Integration not found", 404);
  }
  // Scaffolds have no real adapter and no allowlisted safe action: running
  // them could only ever produce a fake success, so they are refused before
  // any row is created.
  if (!resolveTestActions(input.integrationName).length) {
    throw new TestExecutionError(
      "NO_SAFE_ACTION",
      "This integration has no allowlisted safe action to test",
      409,
    );
  }

  const descriptor: TestActionDescriptor | null = resolveTestAction(input.integrationName, input.action);
  if (!descriptor) {
    throw new TestExecutionError(
      "ACTION_NOT_ALLOWED",
      `action "${input.action ?? ""}" is not an allowlisted safe test action for this integration`,
      400,
    );
  }

  const config = adapter.validateConfiguration();
  const missingEnvVars = adapter.requiredEnvVars.filter((name) => !config.presentEnvVars.includes(name));
  const integrationStatus = missingEnvVars.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED";

  const prisma = getPrisma();
  const taskId = testTaskId(input.requestId);

  // Reuse an existing task for the same request id (duplicate submission).
  const existingTask = await prisma.agentTask.findFirst({ where: { id: taskId, ownerId: input.ownerId } });
  if (!existingTask) {
    const agent = await prisma.agent.findFirst({
      where: { type: agentTypeForTaskType(descriptor.taskType), status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!agent) {
      throw new TestExecutionError("NO_SAFE_ACTION", "No active agent is registered for this test action", 409);
    }
    await prisma.agentTask.create({
      data: {
        id: taskId,
        agentId: agent.id,
        ownerId: input.ownerId,
        opportunityId: input.opportunityId ?? null,
        experimentId: input.experimentId ?? null,
        taskType: descriptor.taskType,
        objective: descriptor.objective.slice(0, 600),
        instructions: descriptor.instructions.slice(0, 4_000),
        inputs: { query: descriptor.objective, testExecution: true, requestId: input.requestId },
        expectedOutputs: ["provider connectivity result"],
        constraints: ["test execution", "no publishing", "no spending", "no external messages"],
        timeLimitSeconds: TEST_EXECUTION_LIMITS.timeLimitSeconds,
        maxOutputChars: TEST_EXECUTION_LIMITS.maxOutputChars,
        maxRetries: TEST_EXECUTION_LIMITS.maxRetries,
        maxActions: TEST_EXECUTION_LIMITS.maxActions,
        budgetLimit: TEST_EXECUTION_LIMITS.budgetLimit,
        requiresApproval: false,
        status: "READY",
      },
    });
  }

  const outcome: ExecutionOutcome = await runAgentTaskExecution(taskId, input.ownerId, {
    mode: input.mode ?? "LIVE",
    action: descriptor.action,
  });

  const artifact = await prisma.agentArtifact.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
  const execution = outcome.executionId
    ? await prisma.agentExecution.findUnique({ where: { id: outcome.executionId } })
    : null;

  logger.integrationExecuted(
    input.integrationName,
    descriptor.action,
    outcome.status,
    execution?.durationMs ?? 0,
    input.ownerId,
  );

  return {
    integration: input.integrationName,
    action: descriptor.action,
    capability: descriptor.capability,
    status: outcome.status,
    mode: outcome.mode,
    executionId: outcome.executionId,
    taskId,
    artifactId: artifact?.id ?? null,
    dataClass: execution?.dataClass ?? null,
    durationMs: execution?.durationMs ?? null,
    error: execution?.error ?? null,
    outputExcerpt: outcome.result ? excerpt(outcome.result.output) : null,
    message: outcome.message,
    configured: missingEnvVars.length === 0,
    integrationStatus,
    missingEnvVars,
  };
}

function agentTypeForTaskType(taskType: AgentTaskType): "RESEARCH" | "SEO" | "PRODUCT" | "ANALYTICS" {
  switch (taskType) {
    case "RESEARCH":
    case "SEO_RESEARCH":
    case "AFFILIATE_RESEARCH":
      return "RESEARCH";
    case "CONTENT_DRAFT":
    case "LANDING_PAGE_DRAFT":
    case "PIN_CONTENT_DRAFT":
      return "SEO";
    case "PRODUCT_OUTLINE":
      return "PRODUCT";
    case "EXPERIMENT_ANALYSIS":
    case "REPORT_GENERATION":
      return "ANALYTICS";
    default:
      return "RESEARCH";
  }
}

export { sanitizeRequestId };
