import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { ACTIVATION_BOUNDS, getProviderActivations } from "@/lib/integrations/activation-service";
import { requireUser } from "@/lib/server/authz";

/**
 * Phase 15 — safe provider activation metadata. This endpoint reads only the
 * existing bounded registry/configuration and persisted IntegrationHealth rows;
 * it never runs a provider probe and never returns environment values.
 */
export async function GET() {
  try {
    await requireUser();
    const activations = await getProviderActivations();
    return NextResponse.json({
      activations,
      generatedAt: new Date().toISOString(),
      bounds: ACTIVATION_BOUNDS,
    });
  } catch (error) {
    return apiError(error, "Failed to load provider activation status");
  }
}
