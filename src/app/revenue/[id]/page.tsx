"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { revenueRepository, opportunityRepository } from "@/lib/repositories";
import type { RevenueEntry, Opportunity } from "@/lib/types";
import { Card, CardHeader, Button, Badge, statusBadgeClass } from "@/components/ui";

export default function RevenueDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [revenue, setRevenue] = useState<RevenueEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [editForm, setEditForm] = useState<Partial<RevenueEntry>>({});

  useEffect(() => {
    async function loadRevenue() {
      const data = await revenueRepository.getById(params.id);
      if (!data) {
        setLoading(false);
        return;
      }
      setRevenue(data);
      setEditForm(data);

      // Load linked opportunity if exists
      if (data.opportunityId) {
        const opp = await opportunityRepository.getById(data.opportunityId);
        setOpportunity(opp);
      }

      // Check if this is sample data
      const sample = await revenueRepository.isSample(params.id);
      setIsSample(sample);

      setLoading(false);
    }
    loadRevenue();
  }, [params.id]);

  if (loading) return <div className="p-8 text-center">Loading revenue data...</div>;
  if (!revenue) return notFound();

  const calculatedNet = (editForm.grossRevenue ?? revenue.grossRevenue) - 
    (editForm.fees ?? revenue.fees) - 
    (editForm.advertisingCost ?? revenue.advertisingCost) - 
    (editForm.otherCosts ?? revenue.otherCosts);

  const handleSave = async () => {
    await revenueRepository.update(params.id, {
      ...editForm,
      netRevenue: calculatedNet,
    });
    setRevenue({ ...revenue, ...editForm, netRevenue: calculatedNet });
    setIsEditing(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (isSample) {
      alert("Sample revenue entries cannot be deleted.");
      return;
    }
    if (confirm("Are you sure you want to delete this revenue entry? This action cannot be undone.")) {
      await revenueRepository.delete(params.id);
      router.push("/revenue");
    }
  };

  const revenueSources: RevenueEntry["revenueSource"][] = [
    "PRODUCT_SALES", "AFFILIATE_COMMISSION", "SAAS_SUBSCRIPTION", "ADS", "OTHER"
  ];

  return (
    <div className="space-y-4">
      <Link href="/revenue" className="text-sm text-blue-600">← Back to revenue</Link>
      <div className="flex flex-wrap items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editForm.referenceNote || revenue.referenceNote || "Revenue Entry"}
            onChange={(e) => setEditForm({ ...editForm, referenceNote: e.target.value })}
            className="text-2xl font-bold border-b border-blue-600 focus:outline-none"
          />
        ) : (
          <h1 className="text-2xl font-bold">{revenue.referenceNote || "Revenue Entry"}</h1>
        )}
        {isSample && <Badge className="bg-amber-100 text-amber-700">Sample Data</Badge>}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isEditing && !isSample && (
          <>
            <Button onClick={() => setIsEditing(true)}>Edit</Button>
            <Button variant="danger" onClick={handleDelete}>Delete</Button>
          </>
        )}
        {isEditing && (
          <>
            <Button onClick={handleSave}>Save Changes</Button>
            <Link href="/revenue">
              <Button variant="secondary" onClick={() => { setIsEditing(false); setEditForm(revenue); }}>Cancel</Button>
            </Link>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue Details" />
          <div className="space-y-3 p-5 text-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-slate-500">Date</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.date || revenue.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                  />
                ) : (
                  <p className="font-medium">{new Date(revenue.date).toLocaleDateString()}</p>
                )}
              </div>
              <div>
                <p className="text-slate-500">Source</p>
                {isEditing ? (
                  <select
                    value={editForm.revenueSource || revenue.revenueSource}
                    onChange={(e) => setEditForm({ ...editForm, revenueSource: e.target.value as RevenueEntry["revenueSource"] })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                  >
                    {revenueSources.map(source => (
                      <option key={source} value={source}>{source.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                ) : (
                  <p className="font-medium">{revenue.revenueSource.replace(/_/g, " ")}</p>
                )}
              </div>
            </div>

            {opportunity && (
              <div>
                <p className="text-slate-500">Linked Opportunity</p>
                <Link href={`/opportunities/${opportunity.id}`} className="font-medium text-blue-600 hover:underline">
                  {opportunity.title}
                </Link>
              </div>
            )}

            <div className="mt-6 pt-4 border-t space-y-3">
              <div className="flex justify-between items-center">
                <span>Gross Revenue</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.grossRevenue ?? revenue.grossRevenue}
                    onChange={(e) => setEditForm({ ...editForm, grossRevenue: Number(e.target.value) })}
                    className="w-32 rounded-md border border-slate-200 px-3 py-1 text-right"
                    min="0"
                  />
                ) : (
                  <span className="font-medium">{formatCurrency(revenue.grossRevenue)}</span>
                )}
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Fees</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.fees ?? revenue.fees}
                    onChange={(e) => setEditForm({ ...editForm, fees: Number(e.target.value) })}
                    className="w-32 rounded-md border border-slate-200 px-3 py-1 text-right"
                    min="0"
                  />
                ) : (
                  <span>-{formatCurrency(revenue.fees)}</span>
                )}
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Advertising Costs</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.advertisingCost ?? revenue.advertisingCost}
                    onChange={(e) => setEditForm({ ...editForm, advertisingCost: Number(e.target.value) })}
                    className="w-32 rounded-md border border-slate-200 px-3 py-1 text-right"
                    min="0"
                  />
                ) : (
                  <span>-{formatCurrency(revenue.advertisingCost)}</span>
                )}
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Other Costs</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.otherCosts ?? revenue.otherCosts}
                    onChange={(e) => setEditForm({ ...editForm, otherCosts: Number(e.target.value) })}
                    className="w-32 rounded-md border border-slate-200 px-3 py-1 text-right"
                    min="0"
                  />
                ) : (
                  <span>-{formatCurrency(revenue.otherCosts)}</span>
                )}
              </div>
              <div className="flex justify-between items-center pt-3 border-t font-semibold">
                <span>Net Revenue</span>
                <span className={calculatedNet >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {formatCurrency(calculatedNet)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Notes" />
          <div className="p-5 text-sm">
            {isEditing ? (
              <textarea
                value={editForm.referenceNote || revenue.referenceNote || ""}
                onChange={(e) => setEditForm({ ...editForm, referenceNote: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={8}
                placeholder="Add notes about this revenue entry..."
              />
            ) : (
              <p className="text-slate-600">{revenue.referenceNote || "No notes available."}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}