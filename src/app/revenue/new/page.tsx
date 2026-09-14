"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { revenueRepository, opportunityRepository } from "@/lib/repositories";
import type { Opportunity } from "@/lib/types";
import { Card, Button } from "@/components/ui";

export default function NewRevenueEntryPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    opportunityId: "",
    revenueSource: "PRODUCT_SALES" as const,
    grossRevenue: 0,
    fees: 0,
    advertisingCost: 0,
    otherCosts: 0,
    currency: "USD",
    referenceNote: "",
  });

  useEffect(() => {
    async function loadOpportunities() {
      const data = await opportunityRepository.getAll();
      setOpportunities(data);
    }
    loadOpportunities();
  }, []);

  const calculatedNet = formData.grossRevenue - formData.fees - formData.advertisingCost - formData.otherCosts;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: ["grossRevenue", "fees", "advertisingCost", "otherCosts"].includes(name) 
        ? Number(value) 
        : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.grossRevenue) {
      alert("Please enter a gross revenue amount");
      return;
    }

    setSaving(true);
    
    try {
      await revenueRepository.create({
        date: formData.date,
        opportunityId: formData.opportunityId || null,
        revenueSource: formData.revenueSource,
        grossRevenue: formData.grossRevenue,
        fees: formData.fees,
        advertisingCost: formData.advertisingCost,
        otherCosts: formData.otherCosts,
        netRevenue: calculatedNet,
        currency: formData.currency,
        referenceNote: formData.referenceNote,
      });
      
      router.push("/revenue");
    } catch (error) {
      console.error("Failed to create revenue entry:", error);
      alert("Failed to create revenue entry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const revenueSources = [
    "PRODUCT_SALES",
    "AFFILIATE_COMMISSION",
    "SAAS_SUBSCRIPTION",
    "ADS",
    "OTHER"
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/revenue">
          <Button variant="secondary">← Back</Button>
        </Link>
        <h1 className="text-2xl font-bold">Add New Revenue Entry</h1>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Revenue Information */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basic Information</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Date *</label>
                <input
                  type="date"
                  name="date"
                  value={formData.date}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Revenue Source *</label>
                <select
                  name="revenueSource"
                  value={formData.revenueSource}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                >
                  {revenueSources.map(source => (
                    <option key={source} value={source}>{source.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Linked Opportunity (optional)</label>
              <select
                name="opportunityId"
                value={formData.opportunityId}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
              >
                <option value="">None</option>
                {opportunities.map(opp => (
                  <option key={opp.id} value={opp.id}>{opp.title}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Financial Details */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Financial Details</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Gross Revenue ($) *</label>
                <input
                  type="number"
                  name="grossRevenue"
                  value={formData.grossRevenue}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Fees ($)</label>
                <input
                  type="number"
                  name="fees"
                  value={formData.fees}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">Advertising Costs ($)</label>
                <input
                  type="number"
                  name="advertisingCost"
                  value={formData.advertisingCost}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Other Costs ($)</label>
                <input
                  type="number"
                  name="otherCosts"
                  value={formData.otherCosts}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div className="bg-slate-50 rounded-md p-4 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">${calculatedNet.toFixed(2)}</div>
                  <div className="text-xs text-slate-500">Calculated Net Revenue</div>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Additional Notes</h2>
            
            <div>
              <label className="block text-sm font-medium mb-1">Reference Notes</label>
              <textarea
                name="referenceNote"
                value={formData.referenceNote}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={3}
                placeholder="Any additional notes about this revenue entry (order number, transaction ID, etc.)"
              />
            </div>
          </div>

          <div className="flex gap-4 pt-4 border-t">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Revenue Entry"}
            </Button>
            <Link href="/revenue">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}