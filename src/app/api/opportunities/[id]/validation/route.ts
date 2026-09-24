import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { logger } from "@/lib/server/logger";
import { getOpportunityValidation } from "@/lib/server/opportunity-validation-service";

function safeId(value: string): string {
  return value.trim().slice(0, 64);
}

async function load(id: string, ownerId: string) {
  return getOpportunityValidation(safeId(id), ownerId);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    const validation = await load(id, user.id);
    if (!validation) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    return NextResponse.json({ opportunityId: id, validation });
  } catch (error) {
    return apiError(error, "Failed to load opportunity validation");
  }
}

/** Re-evaluates persisted state only; it never runs a provider or experiment. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = safeId(params.id);
    logger.operationalEvent({
      event: "OPPORTUNITY_VALIDATION_STARTED",
      safeMessage: `Validation check started for opportunity ${id}.`,
      severity: "INFO",
      dataClass: "UNKNOWN",
    });
    const validation = await load(id, user.id);
    if (!validation) {
      logger.operationalEvent({
        event: "OPPORTUNITY_VALIDATION_BLOCKED",
        safeMessage: `Validation could not access opportunity ${id} for the authenticated owner.`,
        severity: "WARNING",
        dataClass: "UNKNOWN",
      });
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    logger.operationalEvent({
      event: validation.state === "BLOCKED" ? "OPPORTUNITY_VALIDATION_BLOCKED" : "OPPORTUNITY_VALIDATION_COMPLETED",
      safeMessage: `Validation completed with state ${validation.state}; ${validation.reasons.join(" ")}`,
      severity: validation.state === "BLOCKED" ? "WARNING" : "INFO",
      dataClass: validation.dataClass,
    });
    return NextResponse.json({ opportunityId: id, validation, persisted: false });
  } catch (error) {
    return apiError(error, "Failed to validate opportunity");
  }
}
