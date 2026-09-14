"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { experimentRepository, opportunityRepository } from "@/lib/repositories";
import type { Opportunity } from "@/lib/types";
import { Card, Button } from "@/components/ui";

export default function NewExperimentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  
  const [formData, setFormData] = useState({
    hypothesis: "",
    opportunityId: "",
    target: "",
    budget: 1000,
    startDate: new Date().toISOString().split('T')[0],
    expectedResult: "",
    visitors: 0,
    leads: 0,
    clicks: 0,
    sales: 0,
    revenue: 0,
    status: "PLANNED" as "PLANNED" | "ACTIVE" | "COMPLETED" | "FAILED" | "PAUSED",
  });

  useEffect(() => {
    async function loadOpportunities() {
      const data = await opportunityRepository.getAll();
      setOpportunities(data);
    }
    loadOpportunities();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name.includes("visitors") || name.includes("leads") || name.includes("clicks") || name.includes("sales") || name.includes("revenue") || name.includes("budget") 
        ? Number(value) 
        : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.hypothesis || !formData.opportunityId || !formData.target) {
      alert("Please fill in all required fields");
      return;
    }

    setSaving(true);
    
    try {
      await experimentRepository.create({
        hypothesis: formData.hypothesis,
        opportunityId: formData.opportunityId,
        target: formData.target,
        budget: formData.budget,
        startDate: formData.startDate,
        endDate: null,
        expectedResult: formData.expectedResult,
        actualResult: null,
        visitors: formData.visitors,
        leads: formData.leads,
        clicks: formData.clicks,
        sales: formData.sales,
        revenue: formData.revenue,
        profit: formData.revenue - formData.budget,
        conversionRate: formData.visitors > 0 ? (formData.sales / formData.visitors) * 100 : 0,
        decision: null,
        status: formData.status,
      });
      
      router.push("/experiments");
    } catch (error) {
      console.error("Failed to create experiment:", error);
      alert("Failed to create experiment. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const statuses = ["PLANNED", "ACTIVE", "COMPLETED", "FAILED", "PAUSED"];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/experiments">
          <Button variant="secondary">← Back</Button>
        </Link>
        <h1 className="text-2xl font-bold">Create New Experiment</h1>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Experiment Information */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basic Information</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Linked Opportunity *</label>
                <select
                  name="opportunityId"
                  value={formData.opportunityId}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  required
                >
                  <option value="">Select an opportunity</option>
                  {opportunities.map(opp => (
                    <option key={opp.id} value={opp.id}>{opp.title}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Hypothesis *</label>
              <textarea
                name="hypothesis"
                value={formData.hypothesis}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={2}
                placeholder="What hypothesis are you testing with this experiment?"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Target Metric *</label>
              <input
                type="text"
                name="target"
                value={formData.target}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                placeholder="e.g., 100 signups in 30 days"
                required
              />
            </div>
          </div>

          {/* Budget & Timeline */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Budget & Timeline</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Budget ($)</label>
                <input
                  type="number"
                  name="budget"
                  value={formData.budget}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Start Date</label>
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Expected Result</label>
              <textarea
                name="expectedResult"
                value={formData.expectedResult}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 px-3 py-2"
                rows={2}
                placeholder="What results do you expect from this experiment?"
              />
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-4 border-t pt-6">
            <h2 className="text-lg font-semibold">Initial Metrics (if any)</h2>
            
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">Visitors</label>
                <input
                  type="number"
                  name="visitors"
                  value={formData.visitors}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Leads</label>
                <input
                  type="number"
                  name="leads"
                  value={formData.leads}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Clicks</label>
                <input
                  type="number"
                  name="clicks"
                  value={formData.clicks}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Sales</label>
                <input
                  type="number"
                  name="sales"
                  value={formData.sales}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Revenue ($)</label>
                <input
                  type="number"
                  name="revenue"
                  value={formData.revenue}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4 border-t">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Experiment"}
            </Button>
            <Link href="/experiments">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}