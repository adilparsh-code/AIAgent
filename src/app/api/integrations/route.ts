import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { listIntegrationSummaries } from "@/lib/integrations/service";

/**
 * Phase 8 — list all registered integrations with their honest status.
 * Authenticated (any ACTIVE user): integrations are system-level registry
 * entries; status/capabilities/env-var NAMES are not tenant-private data.
 * Secret values never leave the server.
 */
export async function GET() {
  try {
    await requireUser();
    const integrations = await listIntegrationSummaries();
    return NextResponse.json({ integrations });
  } catch (error) {
    return apiError(error, "Failed to list integrations");
  }
}
