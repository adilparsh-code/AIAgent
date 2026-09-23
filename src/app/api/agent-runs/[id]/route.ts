import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma } from "@/lib/db";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const run = await getPrisma().agentRun.findFirst({
      where: { id: params.id, ownerId: user.id },
      include: { agentTask: { include: { artifacts: true } }, agent: true },
    });
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: run.id,
      agentId: run.agentId,
      agentName: run.agent.name,
      agentTaskId: run.agentTaskId,
      task: run.task,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      input: run.input,
      output: run.output,
      errors: run.errors,
      metadata: run.metadata,
      artifacts: run.agentTask?.artifacts ?? [],
    });
  } catch (error) {
    return apiError(error, "Failed to load agent run");
  }
}
