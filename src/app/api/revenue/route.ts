import { NextResponse } from "next/server";
import { revenueRepository } from "@/lib/server/repositories/revenue";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import { pickFields, readWriteBody, WRITE_INPUT_LIMITS, type FieldSpec } from "@/lib/write-input";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await revenueRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load revenue");
  }
}

const MAX_MONEY = 1_000_000_000;

/**
 * MEDIUM-2: the create body is size-capped and allowlisted. `netRevenue` is
 * not accepted from a client — the repository always derives it from the
 * recorded components, so a caller cannot record a net figure that does not
 * match the gross/fees/costs that were actually supplied.
 */
const REVENUE_FIELDS: FieldSpec = {
  date: { kind: "string", required: true, maxLength: 40 },
  opportunityId: { kind: "string", maxLength: 64, default: null },
  productId: { kind: "string", maxLength: 64, default: null },
  revenueSource: {
    kind: "string",
    maxLength: WRITE_INPUT_LIMITS.MAX_SHORT_TEXT,
    oneOf: ["PRODUCT_SALES", "AFFILIATE_COMMISSION", "SAAS_SUBSCRIPTION", "ADS", "OTHER"],
    default: "OTHER",
  },
  grossRevenue: { kind: "number", required: true, min: -MAX_MONEY, max: MAX_MONEY },
  fees: { kind: "number", min: -MAX_MONEY, max: MAX_MONEY, default: 0 },
  advertisingCost: { kind: "number", min: -MAX_MONEY, max: MAX_MONEY, default: 0 },
  otherCosts: { kind: "number", min: -MAX_MONEY, max: MAX_MONEY, default: 0 },
  currency: { kind: "string", maxLength: 8, default: "USD" },
  referenceNote: { kind: "string", maxLength: WRITE_INPUT_LIMITS.MAX_LONG_TEXT, default: "" },
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = await readWriteBody(await request.text().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const picked = pickFields(parsed.body, REVENUE_FIELDS);
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: picked.status });

    if (typeof picked.value.opportunityId === "string" && picked.value.opportunityId.length > 0) {
      const owned = await opportunityRepository.getById(picked.value.opportunityId, user.id);
      if (!owned) throw new ForbiddenError("Resource not found");
    }
    // The repository stores `new Date(item.date)`; an unparseable string would
    // otherwise reach Postgres as an invalid timestamp.
    if (Number.isNaN(new Date(String(picked.value.date)).getTime())) {
      return NextResponse.json({ error: "date must be a valid date" }, { status: 400 });
    }
    const created = await revenueRepository.create({
      ...(picked.value as Omit<Parameters<typeof revenueRepository.create>[0], "ownerId">),
      ownerId: user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create revenue entry");
  }
}
