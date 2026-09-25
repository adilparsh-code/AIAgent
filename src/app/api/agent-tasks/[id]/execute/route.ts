import { handleAgentTaskExecutionRequest } from "@/lib/server/agent-execution-endpoint";

/**
 * HIGH-5 — legacy compatibility alias for the hardened execution endpoint.
 *
 * This route used to call `executeAgentTask()` directly, which bypassed the
 * orchestrator's allowlisted-action resolution, permission/approval gates,
 * execution limits, `AgentExecution` audit persistence and idempotency keys.
 * It now delegates to the exact same handler as
 * `POST /api/agent-tasks/[id]/executions`, so both endpoints enforce identical
 * validation, capability checks, execution limits, audit persistence,
 * idempotency and safety controls.
 *
 * The route is kept so existing clients keep working; it is intentionally not
 * a second, weaker execution path.
 */
export async function POST(request: Request, context: { params: { id: string } }) {
  return handleAgentTaskExecutionRequest(request, context.params?.id);
}
