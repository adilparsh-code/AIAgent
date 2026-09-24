import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { getOperationalStatus } from "@/lib/server/system-health-service";

/** GET /api/system/operations — bounded owner-scoped operational summary. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getOperationalStatus(user.id));
  } catch (error) {
    return apiError(error, "Failed to load operational status");
  }
}
