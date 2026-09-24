import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { resolveTestActions, sanitizeRequestId } from "@/lib/integrations/test-execution";
import { runTestExecution, TestExecutionError } from "@/lib/server/test-execution-service";
import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 4_000;
const MAX_ID_LENGTH = 64;

/**
 * Phase 9 — live test execution for one integration.
 *
 * GET  → the safe, allowlisted actions that may be tested (never secrets).
 * POST → run ONE real, bounded, safe provider call with full audit trail.
 *
 * Only zero-financial-impact, allowlisted actions are executable here:
 * PUBLISH / SEND_MESSAGE / CREATE_CAMPAIGN / SPEND_MONEY / UPLOAD are not
 * reachable from this endpoint at all. Duplicate submissions carrying the same
 * requestId resolve to the same AgentTask and therefore the same execution.
 */
export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    const { getIntegrationRegistry } = await import("@/lib/integrations/registry");
    const adapter = getIntegrationRegistry().resolve(id);
    if (!adapter) return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    const actions = resolveTestActions(id);
    return NextResponse.json({
      integration: id,
      testExecutable: actions.length > 0,
      actions,
    });
  } catch (error) {
    return apiError(error, "Failed to load test actions");
  }
}

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }

    const raw = await request.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let body: { action?: unknown; requestId?: unknown; mode?: unknown } = {};
    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    if (body.action !== undefined && typeof body.action !== "string") {
      return NextResponse.json({ error: "action must be a string" }, { status: 400 });
    }
    if (body.mode !== undefined && body.mode !== "LIVE" && body.mode !== "DRY_RUN") {
      return NextResponse.json({ error: "mode must be LIVE or DRY_RUN" }, { status: 400 });
    }
    if (body.requestId !== undefined && sanitizeRequestId(body.requestId) === null) {
      return NextResponse.json({ error: "requestId must be 1-64 characters of A-Z, a-z, 0-9, _ or -" }, { status: 400 });
    }
    const requestId = sanitizeRequestId(body.requestId) ?? randomUUID().replace(/-/g, "").slice(0, 32);

    const result = await runTestExecution({
      integrationName: id,
      ownerId: user.id,
      action: typeof body.action === "string" ? body.action : undefined,
      requestId,
      mode: body.mode === "DRY_RUN" ? "DRY_RUN" : "LIVE",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TestExecutionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Test execution failed");
  }
}
