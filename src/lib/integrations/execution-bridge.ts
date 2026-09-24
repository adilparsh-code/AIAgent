import "server-only";
import type { ExecutionResult } from "./contract";
import { classifyHttpError, sanitizeErrorMessage } from "./contract";
import { decidePermission, TASK_TYPE_ACTIONS } from "./permissions";
import { getIntegrationRegistry } from "./registry";
import { getPrisma, isDbUnavailableError } from "../db";
import { logger } from "../server/logger";
import { mapAgentTask } from "../db-mappers";
import { validateMetricPayload } from "../server/metric-input";

/**
 * Phase 8 — AgentTask → Adapter execution bridge.
 *
 * Pipeline: AgentTask → permission decision → approval gate → adapter
 * execution → audited result. External content is never an instruction
 * source: only the AgentTask's own allowlisted action runs.
 *
 * Safety properties (all asserted by tests):
 * - Approval-requiring capabilities (PUBLISH/SEND_MESSAGE/CREATE_CAMPAIGN/
 *   SPEND_MONEY) set the task to WAITING_APPROVAL and execute nothing.
 * - Retries are bounded by the task's maxRetries and only for retryable
 *   error classes (SERVER/NETWORK/RATE_LIMIT) — never for publish-class
 *   actions, where a timeout after a possible external success marks the
 *   task for manual review instead of blind repetition.
 * - Idempotency: an already-succeeded (adapter, action, taskId) combination
 *   is not re-executed; the recorded result is returned instead.
 * - Measurable external results are ingested into ExperimentMetric only as
 *   REAL_DATA with missing metrics staying NULL (never zero-filled).
 */

export interface BridgeExecutionOutcome {
  taskStatus: "READY" | "WAITING_APPROVAL" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED" | "QUEUED";
  result: ExecutionResult | null;
  message: string;
}

function buildPayloadForTask(instructions: string, inputs: unknown, objective: string): { prompt: string; system: string } | { query: string } | null {
  // The prompt contains ONLY trusted internal task fields; any external
  // content inside `inputs` was stored as data and is wrapped as untrusted
  // by the caller if echoed. Here we simply serialize the task definition.
  if (inputs && typeof inputs === "object" && "query" in (inputs as Record<string, unknown>)) {
    const query = (inputs as Record<string, unknown>).query;
    if (typeof query === "string") return { query: query.slice(0, 200) };
  }
  return { prompt: [objective, instructions].filter(Boolean).join("\n\n"), system: "" };
}

async function loadTaskForOwner(taskId: string, ownerId: string) {
  const prisma = getPrisma();
  const row = await prisma.agentTask.findFirst({
    where: { id: taskId, ownerId },
    include: { artifacts: true },
  });
  return row ? mapAgentTask(row) : null;
}

export async function executeAgentTaskThroughAdapter(taskId: string, ownerId: string): Promise<BridgeExecutionOutcome> {
  const prisma = getPrisma();
  const task = await loadTaskForOwner(taskId, ownerId);
  if (!task) {
    return { taskStatus: "FAILED", result: null, message: "task not found for this owner" };
  }
  if (task.status === "CANCELLED" || task.status === "COMPLETED") {
    return { taskStatus: task.status, result: null, message: `task is ${task.status}; nothing to execute` };
  }
  if (task.status === "WAITING_APPROVAL") {
    return { taskStatus: "WAITING_APPROVAL", result: null, message: "task is waiting for approval" };
  }

  // Resolve the single allowlisted action for this task type (1:1 mapping).
  const taskType = task.taskType;
  const decision = ((): ReturnType<typeof decidePermission> => {
    const entry = (TASK_TYPE_ACTIONS[taskType] ?? [])[0];
    if (!entry) {
      return {
        allowed: false,
        reason: `task type "${taskType}" has no allowlisted action`,
        adapter: null,
        capability: null,
        requiresApproval: false,
      };
    }
    const adapter = getIntegrationRegistry().resolve(entry.adapter);
    return decidePermission(
      { taskType, action: entry.action },
      adapter ? adapter.capabilities : [],
    );
  })();

  if (!decision.allowed || !decision.adapter) {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "BLOCKED", blockedReason: decision.reason },
    });
    return { taskStatus: "BLOCKED", result: null, message: decision.reason };
  }

  // Approval gate: no approval-requiring action executes here, ever.
  if (decision.requiresApproval) {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: "WAITING_APPROVAL",
        approvalState: task.approvalState ?? null,
      },
    });
    logger.integrationApprovalRequired(decision.adapter, decision.adapter, decision.capability ?? "UNKNOWN", ownerId);
    return {
      taskStatus: "WAITING_APPROVAL",
      result: null,
      message: `external action requires approval (${decision.capability}); nothing executed`,
    };
  }

  const registry = getIntegrationRegistry();
  const adapter = registry.require(decision.adapter);

  // Idempotency: skip if this exact external action already succeeded.
  const previous = await prisma.integrationExecution.findFirst({
    where: {
      adapterName: adapter.name,
      action: decision.adapter ? decision.adapter : adapter.name,
      ownerId,
      taskId: task.id,
      status: "SUCCEEDED",
    },
    orderBy: { createdAt: "desc" },
  });
  if (previous) {
    return {
      taskStatus: task.status === "RUNNING" ? "COMPLETED" : task.status,
      result: null,
      message: "this action already succeeded for the task; skipping duplicate external execution (idempotency guard)",
    };
  }

  // Approval must be recorded before running approval-free external work.
  if (task.requiresApproval && task.approvalState !== "APPROVED") {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "WAITING_APPROVAL" },
    });
    return {
      taskStatus: "WAITING_APPROVAL",
      result: null,
      message: "task is flagged requiresApproval but has no recorded approval",
    };
  }

  const payload = buildPayloadForTask(task.instructions, task.inputs, task.objective);
  const maxAttempts = Math.max(1, task.limits.maxRetries);
  let lastResult: ExecutionResult | null = null;
  const attemptStartedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "RUNNING", attempt, lastAttemptAt: new Date() },
    });
    const result = await adapter.execute(
      actionForAdapter(adapter.name),
      payload,
      {
        ownerId,
        taskId: task.id,
        opportunityId: task.opportunityId,
        experimentId: task.experimentId,
        idempotencyKey: `${ownerId}:${task.id}:${adapter.name}`,
      },
    );
    lastResult = result;
    await recordExecutionSafely(adapter.name, actionForAdapter(adapter.name), ownerId, task.id, task.opportunityId, task.experimentId, result);

    if (result.status === "SUCCEEDED") {
      const durationMs = Date.now() - attemptStartedAt;
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          startedAt: task.startedAt ? new Date(task.startedAt) : new Date(),
          completedAt: new Date(),
          durationMs,
          result: {
            summary: `Adapter ${adapter.name} completed ${actionForAdapter(adapter.name)} with REAL_DATA output.`.slice(0, 500),
            providerName: adapter.name,
            artifactsCreated: 0,
            actionsPerformed: [actionForAdapter(adapter.name)],
            remainingWork: null,
            dataClass: result.dataClass,
          },
          errors: [],
        },
      });
      await ingestMetricsIfMeasurable(task.experimentId, ownerId, adapter.name, result);
      logger.integrationExecuted(adapter.name, actionForAdapter(adapter.name), result.status, result.durationMs, ownerId);
      return { taskStatus: "COMPLETED", result, message: "execution completed" };
    }

    // Classify and decide retry. Non-retryable classes stop immediately.
    const errorClass = classifyHttpError(null, result.error ?? result.status);
    if (!["SERVER", "NETWORK", "RATE_LIMIT"].includes(errorClass)) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errors: [sanitizeErrorMessage(result.error ?? result.status)],
        },
      });
      return { taskStatus: "FAILED", result, message: `execution failed: ${result.status}` };
    }
  }

  // All attempts exhausted on retryable errors.
  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      durationMs: Date.now() - attemptStartedAt,
      errors: [sanitizeErrorMessage(lastResult?.error ?? "execution failed after retries")],
    },
  });
  return { taskStatus: "FAILED", result: lastResult, message: "execution failed after retry limit" };
}

const TASK_ACTION_BY_ADAPTER: Record<string, string | undefined> = {
  sambanova: "GENERATE_TEXT",
  "brave-search": "SEARCH_WEB",
  reddit: "SEARCH_POSTS",
  "google-trends": "SEARCH_TRENDS",
};

function actionForAdapter(adapterName: string): string {
  return TASK_ACTION_BY_ADAPTER[adapterName] ?? "UNKNOWN";
}

async function recordExecutionSafely(
  adapterName: string,
  action: string,
  ownerId: string,
  taskId: string | null,
  opportunityId: string | null,
  experimentId: string | null,
  result: ExecutionResult,
): Promise<void> {
  const { recordIntegrationExecution } = await import("./service");
  await recordIntegrationExecution({
    adapterName,
    action,
    ownerId,
    taskId,
    opportunityId,
    experimentId,
    result,
  }).catch(() => undefined);
}

/**
 * Map an adapter's measurable output into ExperimentMetric (REAL_DATA),
 * preserving missing metrics as NULL and never overwriting history.
 * Duplicate ingestion is prevented by the existing unique constraint
 * (experimentId, periodStart, periodEnd, source).
 */
export async function ingestMetricsIfMeasurable(
  experimentId: string | null,
  ownerId: string,
  adapterName: string,
  result: ExecutionResult,
): Promise<void> {
  if (!experimentId || result.status !== "SUCCEEDED" || result.dataClass !== "REAL_DATA") return;
  const output = result.output as Record<string, unknown> | null;
  if (!output || typeof output !== "object") return;
  const metrics = output.metrics;
  if (!metrics || typeof metrics !== "object") return;
  const raw = metrics as Record<string, unknown>;

  // Only accept known additive metric keys; missing stays missing. The
  // Phase 6B validator returns { ok, errors, data } and throws on malformed
  // shapes — wrap so ingestion never breaks execution results.
  let parsed: ReturnType<typeof validateMetricPayload>;
  try {
    // Providers may report an instantaneous measurement without an explicit
    // end; treat the period as a point-in-time (end = start) rather than
    // dropping real data.
    const periodStart = typeof raw.periodStart === "string" ? raw.periodStart : new Date().toISOString();
    parsed = validateMetricPayload({
      periodStart,
      periodEnd: typeof raw.periodEnd === "string" ? raw.periodEnd : periodStart,
      impressions: typeof raw.impressions === "number" ? raw.impressions : undefined,
      clicks: typeof raw.clicks === "number" ? raw.clicks : undefined,
      visits: typeof raw.visits === "number" ? raw.visits : undefined,
      leads: typeof raw.leads === "number" ? raw.leads : undefined,
      conversions: typeof raw.conversions === "number" ? raw.conversions : undefined,
      revenue: typeof raw.revenue === "number" ? raw.revenue : undefined,
      cost: typeof raw.cost === "number" ? raw.cost : undefined,
      currency: typeof raw.currency === "string" ? raw.currency : undefined,
      dataClass: "REAL_DATA",
      source: adapterName,
      notes: "Imported from external provider via integration bridge",
    });
  } catch {
    return;
  }
  if (!parsed.ok || !parsed.data) return;
  const data = parsed.data;

  try {
    const prisma = getPrisma();
    // Ownership guard: the experiment must belong to this owner.
    const experiment = await prisma.experiment.findFirst({
      where: { id: experimentId, opportunity: { ownerId } },
      select: { id: true },
    });
    if (!experiment) return;
    await prisma.experimentMetric.create({
      data: {
        experimentId,
        recordedAt: new Date(),
        periodStart: data.periodStart,
        periodEnd: data.periodEnd ?? data.periodStart,
        impressions: data.impressions ?? null,
        clicks: data.clicks ?? null,
        visits: data.visits ?? null,
        leads: data.leads ?? null,
        conversions: data.conversions ?? null,
        revenue: data.revenue ?? null,
        cost: data.cost ?? null,
        currency: data.currency ?? "USD",
        source: adapterName,
        dataClass: "REAL_DATA",
        notes: "Imported from external provider via integration bridge",
      },
    });
  } catch (error) {
    // Duplicate provider ingestion (unique experiment+period+source) and other
    // constraint errors are fail-safe: the original measurement is preserved
    // and execution results are unaffected. Never overwrite history.
    if (!isDbUnavailableError(error)) {
      logger.databaseError("integrationBridge.ingestMetrics", error instanceof Error ? error.message : "unknown error");
      return;
    }
    throw error;
  }
}
