import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getPrisma, isDbUnavailableError } from "@/lib/db";

/**
 * Phase 8 — recent external executions for one adapter. Tenant-scoped: a
 * user sees only their own executions. Rows carry sanitized error/output
 * summaries only — never secrets.
 */
export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { id } = context.params;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, Math.floor(limitParam))) : 20;
    try {
      const executions = await getPrisma().integrationExecution.findMany({
        where: { adapterName: id, ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          action: true,
          status: true,
          externalId: true,
          dataClass: true,
          durationMs: true,
          error: true,
          outputSummary: true,
          taskId: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ executions });
    } catch (error) {
      if (!isDbUnavailableError(error)) throw error;
      return NextResponse.json({ executions: [] });
    }
  } catch (error) {
    return apiError(error, "Failed to list executions");
  }
}
