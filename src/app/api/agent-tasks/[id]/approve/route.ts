import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { setApproval } from "@/lib/server/agent-task-repository";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const task = await setApproval(params.id, user.id, true, user.id);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) { return apiError(error, "Failed to approve agent task"); }
}
