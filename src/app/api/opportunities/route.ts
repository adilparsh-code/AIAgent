import { NextResponse } from "next/server";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { pickFields, readWriteBody, WRITE_INPUT_LIMITS, type FieldSpec } from "@/lib/write-input";

/**
 * Phase 6A — all routes require authentication. List/create are owner-scoped:
 * users only ever see and create their own opportunities. Ownership comes from
 * the session; any client-supplied owner/user id is ignored.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await opportunityRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load opportunities");
  }
}

/**
 * MEDIUM-2: the create body is size-capped and allowlisted.
 *
 * Only the fields below can reach persistence. Everything else the client
 * sends is dropped, so a caller can no longer mass-assign server-owned state.
 * `isSample` is hardcoded false and `overallScore` is recomputed by the
 * repository from the score components, so neither is accepted from a client.
 */
const OPPORTUNITY_FIELDS: FieldSpec = {
  title: { kind: "string", required: true, maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT },
  category: {
    kind: "string",
    required: true,
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: [
      "CHILDRENS_BOOKS",
      "EDUCATIONAL_RESOURCES",
      "TEACHER_RESOURCES",
      "PRINTABLES",
      "AFFILIATE",
      "DIGITAL_TOOLS",
      "SAAS",
    ],
  },
  businessModel: {
    kind: "string",
    required: true,
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: ["DIGITAL_PRODUCT", "AFFILIATE", "SAAS", "PRINTABLE", "EDUCATIONAL", "MARKETPLACE"],
  },
  targetAudience: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  problemSolved: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  monetizationMethod: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  nextAction: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  estimatedStartupCost: { kind: "number", min: 0, max: 10_000_000, default: 0 },
  demandScore: { kind: "number", min: 0, max: 100, default: 0 },
  competitionScore: { kind: "number", min: 0, max: 100, default: 0 },
  commercialIntentScore: { kind: "number", min: 0, max: 100, default: 0 },
  automationScore: { kind: "number", min: 0, max: 100, default: 0 },
  differentiationScore: { kind: "number", min: 0, max: 100, default: 0 },
  monetizationStrengthScore: { kind: "number", min: 0, max: 100, default: 0 },
  halalScore: { kind: "number", min: 0, max: 100, default: 100 },
  halalStatus: {
    kind: "string",
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: ["HALAL", "REVIEW_REQUIRED", "NOT_ALLOWED"],
    default: "HALAL",
  },
  confidence: { kind: "number", min: 0, max: 100, default: 0 },
  status: {
    kind: "string",
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: [
      "IDEA",
      "RESEARCHING",
      "VALIDATING",
      "VALIDATED",
      "BUILDING",
      "PUBLISHED",
      "EARNING",
      "SCALING",
      "PAUSED",
      "REJECTED",
    ],
    default: "IDEA",
  },
  evidence: { kind: "stringArray", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: [] },
  risks: { kind: "stringArray", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: [] },
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = await readWriteBody(await request.text().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const picked = pickFields(parsed.body, OPPORTUNITY_FIELDS);
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: picked.status });

    const created = await opportunityRepository.create({
      ...(picked.value as Omit<Parameters<typeof opportunityRepository.create>[0], "ownerId">),
      // Server-side ownership assignment — request fields cannot override it.
      ownerId: user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create opportunity");
  }
}
