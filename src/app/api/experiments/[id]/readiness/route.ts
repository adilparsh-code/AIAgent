import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { INTEGRATION_CAPABILITIES, type IntegrationCapability } from "@/lib/integrations/contract";
import { requireUser } from "@/lib/server/authz";
import { logger } from "@/lib/server/logger";
import { getExperimentReadiness, type ExperimentReadinessServiceInput } from "@/lib/server/experiment-readiness-service";

const MAX_BODY = 12_000;
const CAPABILITIES = new Set<string>(INTEGRATION_CAPABILITIES);

function safeId(value: string): string { return value.trim().slice(0, 64); }

function readString(value: unknown, max = 600): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function parseInput(body: unknown): ExperimentReadinessServiceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const value = body as Record<string, unknown>;
  const metric = value.successMetric && typeof value.successMetric === "object" ? value.successMetric as Record<string, unknown> : undefined;
  const window = value.measurementWindow && typeof value.measurementWindow === "object" ? value.measurementWindow as Record<string, unknown> : undefined;
  const baseline = value.baseline && typeof value.baseline === "object" ? value.baseline as Record<string, unknown> : undefined;
  const capability = typeof value.allowedCapability === "string" && CAPABILITIES.has(value.allowedCapability) ? value.allowedCapability as IntegrationCapability : undefined;
  return {
    hypothesis: readString(value.hypothesis, 1000),
    objective: readString(value.objective),
    expectedObservation: readString(value.expectedObservation),
    allowedCapability: capability,
    measurementWindow: window && typeof window.from === "string" && typeof window.to === "string" ? { from: window.from, to: window.to } : undefined,
    successMetric: metric && typeof metric.name === "string" && typeof metric.unit === "string" && (metric.direction === "HIGHER_IS_BETTER" || metric.direction === "LOWER_IS_BETTER") ? {
      name: metric.name.slice(0, 120),
      unit: metric.unit as "COUNT" | "CURRENCY" | "RATE" | "DURATION",
      direction: metric.direction,
      sourceRequirement: readString(metric.sourceRequirement, 300) ?? "Source-backed measurement record.",
      numerator: readString(metric.numerator, 120),
      denominator: readString(metric.denominator, 120),
    } : undefined,
    baseline: baseline && typeof baseline.value === "number" && Number.isFinite(baseline.value) && typeof baseline.source === "string" && typeof baseline.measuredAt === "string" ? {
      value: baseline.value, source: baseline.source.slice(0, 120), measuredAt: baseline.measuredAt,
    } : undefined,
    dataClass: value.dataClass === "REAL_DATA" || value.dataClass === "ESTIMATED_DATA" || value.dataClass === "UNKNOWN" ? value.dataClass : undefined,
  };
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const result = await getExperimentReadiness(safeId(params.id), user.id, parseInput(body));
    if (!result) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    logger.operationalEvent({
      event: "EXPERIMENT_READINESS_CHECKED",
      safeMessage: `Experiment readiness checked: ${result.readiness.state}.`,
      severity: result.readiness.ready ? "INFO" : "WARNING",
      dataClass: result.design.ok ? result.design.design.dataClass : "UNKNOWN",
    });
    return NextResponse.json({ experimentId: safeId(params.id), ...result });
  } catch (error) {
    return apiError(error, "Failed to check experiment readiness");
  }
}
