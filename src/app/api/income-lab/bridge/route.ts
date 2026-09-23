import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { bridgeHandoffToIncomeLab } from "@/lib/server/income-lab-bridge";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as { handoffId?: unknown };
    if (typeof body.handoffId !== "string" || !body.handoffId.trim()) {
      return NextResponse.json({ error: "handoffId is required" }, { status: 400 });
    }
    const result = await bridgeHandoffToIncomeLab(body.handoffId, user.id);
    if (!result) return NextResponse.json({ error: "Handoff not found" }, { status: 404 });
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Income Lab bridge failed";
    if (/must be ACCEPTED|could not be created|No enabled execution agent/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return apiError(error, "Income Lab bridge failed");
  }
}
