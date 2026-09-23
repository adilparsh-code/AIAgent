import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { validateAgentTaskCreate, AGENT_TASK_LIMIT_DEFAULTS } from "@/lib/agent-task";
import { createAgentTask, listAgentTasks } from "@/lib/server/agent-task-repository";
import { getPrisma } from "@/lib/db";

const MAX_BODY_BYTES = 24_000;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as any;
    const limit = Number(url.searchParams.get("limit") || 50);
    return NextResponse.json(await listAgentTasks(user.id, status || undefined, Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return apiError(error, "Failed to load agent tasks");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const input = validateAgentTaskCreate(body);
    const prisma = getPrisma();

    const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
    if (!agent || agent.status === "DISABLED") return NextResponse.json({ error: "Agent not found or disabled" }, { status: 404 });

    if (input.opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({ where: { id: input.opportunityId, ownerId: user.id } });
      if (!opportunity) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    if (input.experimentId) {
      const experiment = await prisma.experiment.findFirst({ where: { id: input.experimentId, opportunity: { ownerId: user.id } } });
      if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }

    const requested = { ...AGENT_TASK_LIMIT_DEFAULTS, ...(input.limits || {}) };
    const requiresApproval = Boolean(input.requiresApproval) || requested.budgetLimit > 0;
    const task = await createAgentTask({
      agentId: input.agentId, ownerId: user.id, opportunityId: input.opportunityId,
      experimentId: input.experimentId, taskType: input.taskType, objective: input.objective,
      instructions: input.instructions || "", inputs: input.inputs, expectedOutputs: input.expectedOutputs || [],
      constraints: input.constraints || [], ...requested, requiresApproval,
    });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "AgentTaskValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error, "Failed to create agent task");
  }
}
