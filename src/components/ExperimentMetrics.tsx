"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, Button } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/http";

/**
 * Phase 6B — time-series metrics for one experiment.
 *
 * - The table is the source of truth (mandatory); the bars are a simple
 *   relative visualization of recorded conversions/revenue only and never
 *   imply trends where no data exists.
 * - RECORDED values come from the database; CALCULATED values are derived in
 *   the summary; MISSING renders as "—" — never as zero.
 */

interface MetricRecord {
  id: string;
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
}

interface MetricSummary {
  totals: Record<string, number | null>;
  recordCount: number;
  estimatedRecordCount: number;
  missing: string[];
  derived: {
    ctr: number | null;
    conversionRate: number | null;
    profit: number | null;
    roi: number | null;
    cpc: number | null;
    cpl: number | null;
    cpa: number | null;
    revenuePerVisit: number | null;
  };
  dataClass: "REAL_DATA" | "ESTIMATED_DATA" | "MIXED";
}

const EMPTY_FORM = {
  periodStart: "",
  periodEnd: "",
  impressions: "",
  clicks: "",
  visits: "",
  leads: "",
  conversions: "",
  revenue: "",
  cost: "",
  currency: "USD",
  source: "",
  dataClass: "REAL_DATA",
  notes: "",
};

const COUNT_KEYS = ["impressions", "clicks", "visits", "leads", "conversions"] as const;
const MONEY_KEYS = ["revenue", "cost"] as const;

function formatMoney(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatRatio(value: number | null, percent = false): string {
  if (value === null) return "—";
  return percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
}

export function ExperimentMetrics({ experimentId }: { experimentId: string }) {
  const [records, setRecords] = useState<MetricRecord[] | null>(null);
  const [summary, setSummary] = useState<MetricSummary | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [series, summaryData] = await Promise.all([
        apiGet<MetricRecord[]>(`/api/experiments/${experimentId}/metrics`),
        apiGet<{ summary: MetricSummary }>(`/api/experiments/${experimentId}/metrics/summary`),
      ]);
      setRecords(series);
      setSummary(summaryData.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoaded(true);
    }
  }, [experimentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        currency: form.currency || undefined,
        source: form.source || undefined,
        dataClass: form.dataClass,
        notes: form.notes || undefined,
      };
      // Empty string = not measured (stays missing); a number = recorded value.
      if (form.periodStart) payload.periodStart = new Date(form.periodStart).toISOString();
      if (form.periodEnd) payload.periodEnd = new Date(form.periodEnd).toISOString();
      for (const key of [...COUNT_KEYS, ...MONEY_KEYS]) {
        const raw = form[key].trim();
        if (raw !== "") payload[key] = Number(raw);
      }
      await apiSend(`/api/experiments/${experimentId}/metrics`, "POST", payload);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record metric");
    } finally {
      setBusy(false);
    }
  }

  const maxConversions = records
    ? Math.max(0, ...records.map((r) => r.conversions ?? 0))
    : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Metric time series" subtitle="Append-only measurement records — raw data is preserved; derived values are calculated, never stored as measurements." />
        <div className="p-5">
          {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!loaded ? (
            <p className="text-sm text-slate-500">Loading metrics…</p>
          ) : !records || records.length === 0 ? (
            <p className="text-sm text-slate-500">
              No metric periods recorded yet. Add real measurements below — missing data is never estimated.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Period</th>
                    <th className="px-2 py-2">Impr.</th>
                    <th className="px-2 py-2">Clicks</th>
                    <th className="px-2 py-2">Visits</th>
                    <th className="px-2 py-2">Leads</th>
                    <th className="px-2 py-2">Conv.</th>
                    <th className="px-2 py-2">Revenue</th>
                    <th className="px-2 py-2">Cost</th>
                    <th className="px-2 py-2">Class</th>
                    <th className="px-2 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(record.periodStart).toLocaleDateString()}
                        {new Date(record.periodStart).toDateString() !== new Date(record.periodEnd).toDateString()
                          ? ` → ${new Date(record.periodEnd).toLocaleDateString()}`
                          : ""}
                      </td>
                      {COUNT_KEYS.map((key) => (
                        <td key={key} className="px-2 py-2">{record[key] === null ? "—" : record[key]}</td>
                      ))}
                      <td className="px-2 py-2">{formatMoney(record.revenue)}</td>
                      <td className="px-2 py-2">{formatMoney(record.cost)}</td>
                      <td className="px-2 py-2">
                        <span className={record.dataClass === "REAL_DATA" ? "text-emerald-700" : "text-amber-700"}>
                          {record.dataClass === "REAL_DATA" ? "recorded" : "estimated"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-slate-500">{record.source || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400">
                “—” means the measurement was not recorded for that period (unknown, not zero).
              </p>

              {/* Relative visualization of recorded conversions only. */}
              {maxConversions > 0 && (
                <div className="mt-4 space-y-1" aria-hidden>
                  {records.map((record) => (
                    <div key={`${record.id}-bar`} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-slate-500">
                        {new Date(record.periodStart).toLocaleDateString()}
                      </span>
                      <div className="h-2 flex-1 rounded bg-slate-100">
                        <div
                          className="h-2 rounded bg-blue-500"
                          style={{ width: `${record.conversions === null ? 0 : (record.conversions / maxConversions) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs text-slate-500">
                        {record.conversions === null ? "—" : record.conversions}
                      </span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-400">Recorded conversions per period (relative).</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {summary && summary.recordCount > 0 && (
        <Card>
          <CardHeader title="Summary (calculated from recorded data)" subtitle={`Aggregated over ${summary.recordCount} period(s) · ${summary.dataClass === "MIXED" ? "mixed real/estimated" : summary.dataClass === "ESTIMATED_DATA" ? "estimated data only" : "real recorded data"}`} />
          <div className="grid gap-3 p-5 text-sm md:grid-cols-3">
            <p><strong>CTR:</strong> {formatRatio(summary.derived.ctr, true)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>Conversion rate:</strong> {formatRatio(summary.derived.conversionRate, true)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>Profit:</strong> {formatMoney(summary.derived.profit)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>ROI:</strong> {formatRatio(summary.derived.roi)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>CPC:</strong> {formatMoney(summary.derived.cpc)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>CPL:</strong> {formatMoney(summary.derived.cpl)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>CPA:</strong> {formatMoney(summary.derived.cpa)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>Revenue / visit:</strong> {formatMoney(summary.derived.revenuePerVisit)} <span className="text-xs text-slate-400">calculated</span></p>
            <p><strong>Total revenue:</strong> {formatMoney(summary.totals.revenue)} <span className="text-xs text-slate-400">recorded</span></p>
            <p><strong>Total cost:</strong> {formatMoney(summary.totals.cost)} <span className="text-xs text-slate-400">recorded</span></p>
            <p><strong>Total conversions:</strong> {summary.totals.conversions === null ? "—" : summary.totals.conversions} <span className="text-xs text-slate-400">recorded</span></p>
          </div>
          {summary.missing.length > 0 && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              Not recorded in any period: {summary.missing.join(", ")} — treated as unknown, never as zero.
            </p>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Record a metric period" subtitle="Append-only: corrections are added as new records, history is never rewritten. REAL_DATA requires a source; otherwise the record is explicitly estimated or not measured." />
        <form onSubmit={handleAdd} className="grid gap-3 p-5 text-sm md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="mb-1 block font-medium">Period start *</span>
            <input type="datetime-local" required value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block font-medium">Period end *</span>
            <input type="datetime-local" required value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          {COUNT_KEYS.map((key) => (
            <label key={key}>
              <span className="mb-1 block font-medium capitalize">{key}</span>
              <input type="number" min={0} step={1} placeholder="not measured" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
          ))}
          {MONEY_KEYS.map((key) => (
            <label key={key}>
              <span className="mb-1 block font-medium capitalize">{key}</span>
              <input type="number" min={0} step="0.01" placeholder="not measured" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
          ))}
          <label>
            <span className="mb-1 block font-medium">Currency</span>
            <input type="text" maxLength={3} placeholder="USD" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label>
            <span className="mb-1 block font-medium">Data class</span>
            <select value={form.dataClass} onChange={(e) => setForm({ ...form, dataClass: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2">
              <option value="REAL_DATA">REAL_DATA (measured)</option>
              <option value="ESTIMATED_DATA">ESTIMATED_DATA (forecast)</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block font-medium">Source (required for REAL_DATA)</span>
            <input type="text" maxLength={120} placeholder="e.g. meta-ads-dashboard" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="md:col-span-4">
            <span className="mb-1 block font-medium">Notes</span>
            <input type="text" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          {error && <p role="alert" className="md:col-span-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="md:col-span-4">
            <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Add metric record"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
