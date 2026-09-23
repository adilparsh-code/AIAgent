import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { validateMetricPayload, validateMetricRange } from "@/lib/server/metric-input";
import { metricRepository } from "@/lib/server/repositories/metrics";
import { orderChronologically } from "@/lib/metric-aggregation";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

const MAX_BODY_BYTES = 8_192;

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * Phase 6B — time-series metrics for an experiment.
 *
 * POST /api/experiments/:id/metrics   → append one measurement record.
 * GET  /api/experiments/:id/metrics   → chronological series (optional ?from&to).
 *
 * Authorization: the experiment must belong to the caller (via its
 * opportunity); a foreign or missing experiment is the same 404. The recording
 * user is taken from the session — never from the payload.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { ok, errors, data } = validateMetricPayload(body);
    if (!ok || !data) {
      return NextResponse.json({ error: errors.join("; ") || "Invalid payload" }, { status: 400 });
    }

    const created = await metricRepository.createForOwner(safeId(params.id), user.id, data, user.id);
    if (!created) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // Unique (experimentId, periodStart, periodEnd, source): the same source
    // already recorded this exact period. 409 — not an error to hide.
    if (
      error instanceof Error &&
      (error.message.includes("Unique constraint") || error.message.includes("P2002"))
    ) {
      return NextResponse.json(
        { error: "A metric record for this experiment, period, and source already exists" },
        { status: 409 },
      );
    }
    return apiError(error, "Failed to record metric");
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const range = validateMetricRange(searchParams);
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const rows = await metricRepository.listForOwner(safeId(params.id), user.id, {
      from: range.from,
      to: range.to,
    });
    if (rows === null) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }
    return NextResponse.json(orderChronologically(rows));
  } catch (error) {
    return apiError(error, "Failed to load metrics");
  }
}
