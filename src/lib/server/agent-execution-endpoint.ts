/**
 * HIGH-5 — the single agent-task execution request handler.
 *
 * Both agent-task execution routes call this module, so the legacy
 * `POST /api/agent-tasks/[id]/execute` endpoint and the hardened
 * `POST /api/agent-tasks/[id]/executions` endpoint cannot diverge. The legacy
 * route previously called `executeAgentTask()` directly, which bypassed the
 * orchestrator's allowlisted-action resolution, permission/approval gates,
 * execution limits, `AgentExecution` audit persistence and idempotency keys.
 *
 * Every control below is therefore shared, not re-implemented per route:
 *   - identity comes from the server session, never the body;
 *   - the task id is validated and bounded;
 *   - the body is size-capped and strictly parsed;
 *   - `runAgentTaskExecution` performs capability, approval, limit, audit and
 *     idempotency enforcement.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { runAgentTaskExecution } from "@/lib/server/execution-orchestrator";
import type { ExecutionMode } from "@/lib/execution-contract";

const MAX_BODY_BYTES = 4_000;

/** Strictly parse the optional body: only a known `mode` value is accepted. */
async function parseMode(request: Request): Promise<
  { ok: true; mode: ExecutionMode } | { ok: false; response: NextResponse }
> {
  let mode: ExecutionMode = "LIVE";
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: NextResponse.json({ error: "Request body too large" }, { status: 413 }) };
  }
  if (raw.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
    }
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const requestedMode = (body as Record<string, unknown>).mode;
      if (requestedMode !== undefined) {
        if (requestedMode !== "LIVE" && requestedMode !== "DRY_RUN") {
          return {
            ok: false,
            response: NextResponse.json({ error: "mode must be LIVE or DRY_RUN" }, { status: 400 }),
          };
        }
        mode = requestedMode;
      }
    }
  }
  return { ok: true, mode };
}

/**
 * Shared POST handler for every agent-task execution route.
 *
 * `taskId` is taken from the route params, never from the request body.
 */
export async function handleAgentTaskExecutionRequest(
  request: Request,
  taskId: unknown,
): Promise<Response> {
  try {
    const user = await requireUser();
    if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > 64) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const parsed = await parseMode(request);
    if (!parsed.ok) return parsed.response;

    const outcome = await runAgentTaskExecution(taskId, user.id, { mode: parsed.mode });
    if (outcome.executionId === null && outcome.status === "BLOCKED" && outcome.message.startsWith("task not found")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(outcome);
  } catch (error) {
    return apiError(error, "Agent task execution failed");
  }
}
