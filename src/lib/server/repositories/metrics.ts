import "server-only";
import type { Prisma, MetricDataClass } from "@prisma/client";
import { getPrisma } from "../../db";
import type { ExperimentMetricInput } from "../metric-input";

/**
 * Phase 6B — persistence for time-series experiment metrics.
 * Every query is owner-scoped through Experiment → Opportunity.ownerId so a
 * user can only ever reach their own measurements (Phase 6A model).
 */
export interface MetricRecordView {
  id: string;
  experimentId: string;
  recordedAt: string;
  periodStart: string;
  periodEnd: string;
  impressions: number | null;
  clicks: number | null;
  visits: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
  cost: number | null;
  currency: string;
  source: string;
  dataClass: "REAL_DATA" | "ESTIMATED_DATA";
  notes: string;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type MetricRow = Prisma.ExperimentMetricGetPayload<object>;

function mapMetric(row: MetricRow): MetricRecordView {
  return {
    id: row.id,
    experimentId: row.experimentId,
    recordedAt: row.recordedAt.toISOString(),
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    impressions: row.impressions,
    clicks: row.clicks,
    visits: row.visits,
    leads: row.leads,
    conversions: row.conversions,
    revenue: row.revenue === null ? null : Number(row.revenue),
    cost: row.cost === null ? null : Number(row.cost),
    currency: row.currency,
    source: row.source,
    dataClass: row.dataClass,
    notes: row.notes,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ORDER_BY: Prisma.ExperimentMetricOrderByWithRelationInput[] = [
  { periodStart: "asc" },
  { periodEnd: "asc" },
];

export class PrismaMetricRepository {
  /** Create (append) a metric record on an experiment the owner controls. */
  async createForOwner(
    experimentId: string,
    ownerId: string,
    input: ExperimentMetricInput,
    recordedBy: string,
  ): Promise<MetricRecordView | null> {
    const owned = await getPrisma().experiment.findFirst({
      where: { id: experimentId, isSample: false, opportunity: { ownerId } },
      select: { id: true },
    });
    if (!owned) return null;
    return this.create(experimentId, input, recordedBy);
  }

  /** Unscoped append used by tests/services that already verified ownership. */
  async create(experimentId: string, input: ExperimentMetricInput, recordedBy: string | null): Promise<MetricRecordView> {
    if (input.dataClass === "REAL_DATA" && !input.source.trim()) {
      throw new Error("REAL_DATA metric requires a non-empty source provenance");
    }
    const row = await getPrisma().experimentMetric.create({
      data: {
        experimentId,
        recordedAt: input.recordedAt,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        impressions: input.impressions,
        clicks: input.clicks,
        visits: input.visits,
        leads: input.leads,
        conversions: input.conversions,
        revenue: input.revenue,
        cost: input.cost,
        currency: input.currency,
        source: input.source,
        dataClass: input.dataClass,
        notes: input.notes,
        recordedBy,
      },
    });
    return mapMetric(row);
  }

  /** Chronological series for one experiment, scoped to the owner. */
  async listForOwner(
    experimentId: string,
    ownerId: string,
    range?: { from?: Date; to?: Date },
  ): Promise<MetricRecordView[] | null> {
    const owned = await getPrisma().experiment.findFirst({
      where: { id: experimentId, isSample: false, opportunity: { ownerId } },
      select: { id: true },
    });
    if (!owned) return null;
    const rows = await getPrisma().experimentMetric.findMany({
      where: {
        experimentId,
        // Overlap semantics: a record is in the window when its period ends on
        // or after `from` AND starts on or before `to` (both bounds inclusive).
        ...(range?.from ? { periodEnd: { gte: range.from } } : {}),
        ...(range?.to ? { periodStart: { lte: range.to } } : {}),
      },
      orderBy: ORDER_BY,
    });
    return rows.map(mapMetric);
  }

  /** Single record fetch, owner-scoped. Null when missing OR foreign. */
  async getByIdForOwner(id: string, ownerId: string): Promise<MetricRecordView | null> {
    const row = await getPrisma().experimentMetric.findFirst({
      where: { id, experiment: { opportunity: { ownerId } } },
    });
    return row ? mapMetric(row) : null;
  }

  /** Delete a single record, owner-scoped; null when missing OR foreign. */
  async deleteByIdForOwner(id: string, ownerId: string): Promise<MetricRecordView | null> {
    const existing = await this.getByIdForOwner(id, ownerId);
    if (!existing) return null;
    await getPrisma().experimentMetric.delete({ where: { id } });
    return existing;
  }

  /** Append-many used by tests/seeds; ownership must already be verified. */
  async createManyForExperiment(
    experimentId: string,
    inputs: Array<ExperimentMetricInput & { recordedBy?: string | null }>,
  ): Promise<number> {
    if (inputs.some((input) => input.dataClass === "REAL_DATA" && !input.source.trim())) {
      throw new Error("REAL_DATA metric requires a non-empty source provenance");
    }
    const result = await getPrisma().experimentMetric.createMany({
      data: inputs.map((input) => ({
        experimentId,
        recordedAt: input.recordedAt,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        impressions: input.impressions,
        clicks: input.clicks,
        visits: input.visits,
        leads: input.leads,
        conversions: input.conversions,
        revenue: input.revenue,
        cost: input.cost,
        currency: input.currency,
        source: input.source,
        dataClass: input.dataClass as MetricDataClass,
        notes: input.notes,
        recordedBy: input.recordedBy ?? null,
      })),
    });
    return result.count;
  }
}

export const metricRepository = new PrismaMetricRepository();
