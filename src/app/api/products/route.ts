import { NextResponse } from "next/server";
import { productRepository } from "@/lib/server/repositories/products";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import { pickFields, readWriteBody, WRITE_INPUT_LIMITS, type FieldSpec } from "@/lib/write-input";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await productRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load products");
  }
}

/**
 * MEDIUM-2: the create body is size-capped and allowlisted. `ownerId` is not
 * in the spec, so a client-supplied owner can never reach persistence.
 */
const PRODUCT_FIELDS: FieldSpec = {
  name: { kind: "string", required: true, maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT },
  type: {
    kind: "string",
    required: true,
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: [
      "COLORING_BOOK",
      "DRAWING_BOOK",
      "ACTIVITY_BOOK",
      "WORKSHEET",
      "WORKBOOK",
      "PRINTABLE",
      "TEACHER_RESOURCE",
      "DIGITAL_TOOL",
      "AFFILIATE_WEBSITE",
      "SAAS",
    ],
  },
  opportunityId: { kind: "string", maxLength: 64, default: null },
  targetAudience: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  platform: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT, default: "" },
  productUrl: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT },
  affiliateUrl: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT },
  notes: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
  price: { kind: "number", min: 0, max: 1_000_000, default: 0 },
  cost: { kind: "number", min: 0, max: 1_000_000, default: 0 },
  revenue: { kind: "number", min: 0, max: 1_000_000_000, default: 0 },
  metrics: { kind: "any", default: {} },
  status: {
    kind: "string",
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: ["PLANNED", "IN_DEVELOPMENT", "READY", "PUBLISHED", "PAUSED", "RETIRED"],
    default: "PLANNED",
  },
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = await readWriteBody(await request.text().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const picked = pickFields(parsed.body, PRODUCT_FIELDS);
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: picked.status });

    if (typeof picked.value.opportunityId === "string" && picked.value.opportunityId.length > 0) {
      const owned = await opportunityRepository.getById(String(picked.value.opportunityId), user.id);
      if (!owned) throw new ForbiddenError("Resource not found");
    }
    const created = await productRepository.create({
      ...(picked.value as Omit<Parameters<typeof productRepository.create>[0], "ownerId">),
      ownerId: user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create product");
  }
}
