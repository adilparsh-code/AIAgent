import { NextResponse } from "next/server";
import { experimentRepository } from "@/lib/server/repositories/experiments";
import { apiError } from "@/lib/api-error";
import { requireUser } from "@/lib/server/authz";
import { opportunityRepository } from "@/lib/server/repositories/opportunities";
import { ForbiddenError } from "@/lib/authz-errors";
import { validateExperimentPayload } from "@/lib/server/experiment-input";
import type { Experiment } from "@/lib/types";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await experimentRepository.getAll(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error, "Failed to load experiments");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body: unknown = await request.json().catch(() => null);
    const { ok, errors, data } = validateExperimentPayload(body);
    if (!ok || !data) {
      return NextResponse.json({ error: errors.join("; ") || "Invalid payload" }, { status: 400 });
    }

    const { hypothesis, opportunityId, target } = data as Partial<Experiment>;
    if (!hypothesis || !opportunityId || !target) {
      return NextResponse.json(
        { error: "hypothesis, opportunityId, and target are required" },
        { status: 400 },
      );
    }
    // The experiment inherits ownership of the caller's opportunity; creating
    // experiments against another user's opportunity is forbidden.
    const owned = await opportunityRepository.getById(opportunityId, user.id);
    if (!owned) throw new ForbiddenError("Resource not found");

    const created = await experimentRepository.create({
      hypothesis,
      opportunityId,
      target,
      budget: data.budget ?? 0,
      startDate: data.startDate ?? new Date().toISOString(),
      endDate: null,
      expectedResult: data.expectedResult ?? "",
      actualResult: data.actualResult ?? null,
      objective: data.objective ?? "",
      successCriteria: data.successCriteria ?? [],
      metrics: data.metrics ?? null,
      result: data.result ?? null,
      notes: data.notes ?? "",
      feedback: null,
      visitors: 0,
      leads: 0,
      clicks: 0,
      sales: 0,
      revenue: 0,
      profit: 0,
      conversionRate: 0,
      decision: data.decision ?? null,
      status: data.status ?? "PLANNED",
    } as Omit<Experiment, "id" | "createdAt" | "updatedAt">);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create experiment");
  }
}
