import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") || 50);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
    const status = url.searchParams.get("status") || undefined;
    const runs = await getPrisma().agentRun.findMany({
      where: { ownerId: user.id, ...(status ? { status: status as any } : {}) },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { agent: true },
    });
    return NextResponse.json(runs.map((run) => ({
      id: run.id,
      agentId: run.agentId,
      agentName: run.agent.name,
      agentTaskId: run.agentTaskId,
      task: run.task,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      errors: run.errors,
      metadata: run.metadata,
    })));
  } catch (error) {
    return apiError(error, "Failed to load agent runs");
  }
}
