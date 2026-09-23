import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { setApproval } from "@/lib/server/agent-task-repository";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const task = await setApproval(params.id, user.id, false, user.id, reason);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) { return apiError(error, "Failed to reject agent task"); }
}
