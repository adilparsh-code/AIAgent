import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai-provider";

export async function GET() {
  try {
    const user = await requireUser();
    const prisma = getPrisma();
    const [tasks, runs, handoffs, experiments, revenue, agents, provider] = await Promise.all([
      prisma.agentTask.groupBy({ by: ["status"], where: { ownerId: user.id }, _count: { _all: true } }),
      prisma.agentRun.groupBy({ by: ["status"], where: { ownerId: user.id }, _count: { _all: true } }),
      prisma.handoff.groupBy({ by: ["status"], where: { opportunity: { ownerId: user.id } }, _count: { _all: true } }),
      prisma.experiment.groupBy({ by: ["status"], where: { opportunity: { ownerId: user.id } }, _count: { _all: true } }),
      prisma.revenueEntry.aggregate({ where: { ownerId: user.id }, _sum: { netRevenue: true }, _count: { _all: true } }),
      prisma.agent.groupBy({ by: ["status"], where: { isSample: false }, _count: { _all: true } }),
      getAIProvider().health(),
    ]);
    const recentTasks = await prisma.agentTask.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, taskType: true, objective: true, status: true, requiresApproval: true, approvalState: true, updatedAt: true },
    });
    const recentRuns = await prisma.agentRun.findMany({
      where: { ownerId: user.id },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, agentId: true, agentTaskId: true, task: true, status: true, startedAt: true, completedAt: true, errors: true },
    });
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      runtime: { provider: { name: getAIProvider().name, ...provider } },
      tasks: Object.fromEntries(tasks.map((x) => [x.status, x._count._all])),
      runs: Object.fromEntries(runs.map((x) => [x.status, x._count._all])),
      handoffs: Object.fromEntries(handoffs.map((x) => [x.status, x._count._all])),
      experiments: Object.fromEntries(experiments.map((x) => [x.status, x._count._all])),
      agents: Object.fromEntries(agents.map((x) => [x.status, x._count._all])),
      income: { netRevenue: revenue._sum.netRevenue?.toString() ?? "0", entries: revenue._count._all },
      recentTasks,
      recentRuns,
    });
  } catch (error) {
    return apiError(error, "Failed to load control center");
  }
}
