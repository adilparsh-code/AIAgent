import { NextResponse } from "next/server";
import { getPrisma, isDbUnavailableError } from "@/lib/db";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";

const MAX_LIMIT = 100;

/**
 * GET /api/agent-runs?limit=50
 *
 * Owner-scoped agent execution records across all agents for the Agent Runs
 * page. Read-only; runs are created only through the existing authenticated
 * run/task APIs. Only the calling user's runs are returned, and the input /
 * output payloads are intentionally NOT exposed here (they are rendered on
 * the agent detail surface through the existing per-agent runs endpoint).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? 50);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));

    const rows = await getPrisma().agentRun.findMany({
      where: { ownerId: user.id },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentId: true,
        agent: { select: { id: true, name: true, type: true } },
        task: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errors: true,
      },
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: row.agent.name,
        agentType: row.agent.type,
        task: row.task,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        errors: row.errors,
      })),
    );
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to load agent runs");
  }
}
