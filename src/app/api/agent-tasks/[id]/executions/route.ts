import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { handleAgentTaskExecutionRequest } from "@/lib/server/agent-execution-endpoint";
import { isAgentExecutionStatus } from "@/lib/execution-contract";

/**
 * Phase 9A — execute an AgentTask through the provider-independent
 * orchestrator. The body may select mode "DRY_RUN" (validation-only
 * simulation); anything else runs LIVE. Ownership is resolved server-side
 * from the session — never from the body.
 *
 * HIGH-5: the request handling lives in `handleAgentTaskExecutionRequest` so
 * this route and the legacy `/execute` route enforce identical validation,
 * capability checks, execution limits, audit persistence and idempotency.
 */
export async function POST(request: Request, context: { params: { id: string } }) {
  return handleAgentTaskExecutionRequest(request, context.params?.id);
}

/**
 * Phase 9A — list persisted executions for one task (owner-scoped). The
 * optional `status` query filter must be a valid execution status.
 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    if (statusParam !== null && !isAgentExecutionStatus(statusParam)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    const limitParam = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 20;

    const { listExecutionsForTask, getExecutionById } = await import("@/lib/server/execution-repository");
    const { getAgentTask } = await import("@/lib/server/agent-task-repository");
    const task = await getAgentTask(id, user.id);
    if (!task) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const executions = await listExecutionsForTask(id, user.id, limit);
    const filtered = statusParam ? executions.filter((row) => row.status === statusParam) : executions;
    return NextResponse.json({
      taskId: id,
      executions: filtered.map((row) => ({
        id: row.id,
        version: row.version,
        taskId: row.taskId,
        ownerId: row.ownerId,
        opportunityId: row.opportunityId,
        experimentId: row.experimentId,
        integration: row.integration,
        action: row.action,
        capability: row.capability,
        approvalStatus: row.approvalStatus,
        idempotencyKey: row.idempotencyKey,
        status: row.status,
        mode: row.mode,
        dryRun: row.dryRun,
        retryCount: row.retryCount,
        maxAttempts: row.maxAttempts,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        durationMs: row.durationMs,
        result: row.result ?? null,
        error: row.error,
        dataClass: row.dataClass,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      latest: executions.length > 0 ? (await getExecutionById(executions[0].id, user.id))?.id ?? null : null,
    });
  } catch (error) {
    return apiError(error, "Failed to load executions");
  }
}
