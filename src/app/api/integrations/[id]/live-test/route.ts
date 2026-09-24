import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getIntegrationRegistry } from "@/lib/integrations/registry";
import { sanitizeRequestId } from "@/lib/integrations/test-execution";
import { runLiveProviderTest } from "@/lib/server/live-activation-service";

const MAX_BODY_BYTES = 4_000;

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = context.params.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 64) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    if (!getIntegrationRegistry().resolve(id)) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }
    const raw = await request.text().catch(() => "");
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    let body: { requestId?: unknown; action?: unknown } = {};
    if (raw.trim()) {
      try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    }
    if (body.requestId !== undefined && sanitizeRequestId(body.requestId) === null) {
      return NextResponse.json({ error: "requestId must be 1-64 safe characters" }, { status: 400 });
    }
    if (body.action !== undefined && (typeof body.action !== "string" || body.action.length > 80)) {
      return NextResponse.json({ error: "action must be a short string" }, { status: 400 });
    }
    const requestId = sanitizeRequestId(body.requestId) ?? randomUUID().replace(/-/g, "").slice(0, 32);
    const result = await runLiveProviderTest({
      provider: id,
      ownerId: user.id,
      requestId,
      action: typeof body.action === "string" ? body.action : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Provider live test failed");
  }
}
