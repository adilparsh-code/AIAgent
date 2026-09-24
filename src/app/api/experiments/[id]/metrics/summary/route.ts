import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { validateMetricRange } from "@/lib/server/metric-input";
import { metricRepository } from "@/lib/server/repositories/metrics";
import { orderChronologically, summarizeMetricSeries, toPhase5Metrics } from "@/lib/metric-aggregation";
import { MAX_ID_LENGTH } from "@/lib/server/experiment-input";

function safeId(value: string): string {
  return value.trim().slice(0, MAX_ID_LENGTH);
}

/**
 * GET /api/experiments/:id/metrics/summary?from=&to=
 *
 * Aggregate + derived view over the recorded time series: raw totals (sums of
 * recorded values only — missing stays null), cumulative running totals,
 * derived metrics (CTR, conversion rate, profit, ROI, CPC, CPL, CPA, revenue
 * per visit — null where the denominator is missing or zero, never NaN or
 * Infinity), and the flat Phase 5 metrics shape that the existing decision
 * rules consume. Authorization is identical to the series endpoint.
 */
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
    const safeRows = rows.map((row) => ({
      ...row,
      dataClass: row.dataClass === "REAL_DATA" && row.source.trim() ? "REAL_DATA" as const : "ESTIMATED_DATA" as const,
    }));
    const ordered = orderChronologically(safeRows);
    const summary = summarizeMetricSeries(ordered);
    return NextResponse.json({
      summary,
      // Compatibility bridge consumed by the existing Phase 5 decision engine.
      phase5Metrics: toPhase5Metrics(summary),
      evaluationPeriod: {
        from: ordered[0]?.periodStart ?? null,
        to: ordered[ordered.length - 1]?.periodEnd ?? null,
      },
    });
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
    }
    return apiError(error, "Failed to summarize metrics");
  }
}
