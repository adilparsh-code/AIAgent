import { NextResponse } from "next/server";
import { agentRepository } from "@/lib/server/repositories/agents";
import { agentRunRepository } from "@/lib/server/repositories/agent-runs";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import type { AgentRunStatus } from "@/lib/types";

const MAX_TASK_LENGTH = 500;
const MAX_JSON_BYTES = 32 * 1024;

/**
 * GET /api/agents/[id]/runs?limit=20 — persisted execution records for an agent.
 * Phase 6A: only the calling user's runs are returned.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20) || 20));
    const agent = await agentRepository.getById(params.id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const runs = await agentRunRepository.getByAgentIdForOwner(params.id, user.id, limit);
    return NextResponse.json({ agent, runs });
  } catch (error) {
    return apiError(error, "Failed to load agent runs");
  }
}

/**
 * POST /api/agents/[id]/runs — record an agent run.
 * Phase 2 scope: persistence + audit trail only; no agent logic executes.
 * Body: { task, status?, input?, output?, errors?, metadata? }
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const body = (JSON.parse(raw) as {
      task?: unknown;
      status?: unknown;
      input?: unknown;
      output?: unknown;
      errors?: unknown;
      metadata?: unknown;
    }) ?? {};

    if (typeof body.task !== "string" || body.task.trim().length === 0) {
      return NextResponse.json({ error: "task is required" }, { status: 400 });
    }
    const task = body.task.trim().slice(0, MAX_TASK_LENGTH);
    const status =
      typeof body.status === "string" && ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(body.status)
        ? (body.status as AgentRunStatus)
        : "RUNNING";
    const errors = Array.isArray(body.errors)
      ? body.errors.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [];

    const agent = await agentRepository.getById(params.id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const run = await agentRunRepository.create({
      agentId: params.id,
      task,
      status,
      input: body.input,
      output: body.output,
      errors,
      metadata: body.metadata,
      // Ownership from the session, never the request body.
      ownerId: user.id,
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create agent run");
  }
}
