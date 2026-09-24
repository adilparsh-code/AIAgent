import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getIntegrationRegistry } from "@/lib/integrations/registry";
import { activateProvider } from "@/lib/server/live-activation-service";

export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = context.params.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 64) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }
    if (!getIntegrationRegistry().resolve(id)) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }
    const result = await activateProvider({ provider: id, ownerId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Provider activation failed");
  }
}
