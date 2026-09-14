"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { experimentRepository, opportunityRepository } from "@/lib/repositories";
import type { Experiment, Opportunity } from "@/lib/types";
import { Badge, Card, CardHeader, Button, statusBadgeClass } from "@/components/ui";

export default function ExperimentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Experiment>>({});

  useEffect(() => {
    async function loadExperiment() {
      const data = await experimentRepository.getById(params.id);
      if (!data) {
        setLoading(false);
        return;
      }
      setExperiment(data);
      setEditForm(data);
      
      // Load the linked opportunity
      const opp = await opportunityRepository.getById(data.opportunityId);
      setOpportunity(opp);
      
      // Check if this is sample data
      const sample = await experimentRepository.isSample(params.id);
      setIsSample(sample);
      
      setLoading(false);
    }
    loadExperiment();
  }, [params.id]);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!experiment) return notFound();

  const handleSave = async () => {
    await experimentRepository.update(params.id, editForm);
    setExperiment({ ...experiment, ...editForm });
    setIsEditing(false);
    router.refresh();
  };

  const handleDelete = async () => {
    if (isSample) {
      alert("Sample experiments cannot be deleted.");
      return;
    }
    if (confirm("Are you sure you want to delete this experiment? This action cannot be undone.")) {
      await experimentRepository.delete(params.id);
      router.push("/experiments");
    }
  };

  const statuses: Experiment["status"][] = ["PLANNED", "ACTIVE", "COMPLETED", "FAILED", "PAUSED"];
  const decisions: Exclude<Experiment["decision"], null>[] = ["SCALE", "ITERATE", "PAUSE", "KILL"];

  return (
    <div className="space-y-4">
      <Link href="/experiments" className="text-sm text-blue-600">← Back to experiments</Link>
      <div className="flex flex-wrap items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editForm.hypothesis || experiment.hypothesis}
            onChange={(e) => setEditForm({ ...editForm, hypothesis: e.target.value })}
            className="text-2xl font-bold border-b border-blue-600 focus:outline-none"
          />
        ) : (
          <h1 className="text-2xl font-bold">{experiment.hypothesis}</h1>
        )}
        {isEditing ? (
          <select
            value={editForm.status || experiment.status}
            onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Experiment["status"] })}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          >
            {statuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        ) : (
          <Badge className={statusBadgeClass(experiment.decision ?? experiment.status)}>
            {experiment.decision ?? experiment.status}
          </Badge>
        )}
        {isSample && <Badge className="bg-amber-100 text-amber-700">Sample Data</Badge>}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isEditing && !isSample && (
          <>
            <Button onClick={() => setIsEditing(true)}>Edit</Button>
            {!isSample && <Button variant="danger" onClick={handleDelete}>Delete</Button>}
          </>
        )}
        {isEditing && (
          <>
            <Button onClick={handleSave}>Save Changes</Button>
            <Button variant="secondary" onClick={() => { setIsEditing(false); setEditForm(experiment); }}>Cancel</Button>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Overview" />
          <div className="space-y-3 p-5 text-sm">
            {isEditing ? (
              <>
                <div>
                  <label className="block font-medium mb-1">Linked Opportunity</label>
                  <div className="text-slate-700">{opportunity?.title}</div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Target</label>
                  <input
                    type="text"
                    value={editForm.target || experiment.target}
                    onChange={(e) => setEditForm({ ...editForm, target: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Final Decision</label>
                  <select
                    value={editForm.decision || experiment.decision || ""}
                    onChange={(e) => setEditForm({ ...editForm, decision: e.target.value as Experiment["decision"] })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                  >
                    <option value="">None yet</option>
                    {decisions.filter(Boolean).map(decision => (
                      <option key={decision} value={decision}>{decision}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <p><strong>Linked Opportunity:</strong> {opportunity ? (
                  <Link href={`/opportunities/${opportunity.id}`} className="text-blue-600 hover:underline">
                    {opportunity.title}
                  </Link>
                ) : "Unknown"}</p>
                <p><strong>Target:</strong> {experiment.target}</p>
                {experiment.decision && <p><strong>Final Decision:</strong> {experiment.decision}</p>}
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Financials" />
          <div className="space-y-3 p-5 text-sm">
            <p><strong>Budget:</strong> {formatCurrency(experiment.budget)}</p>
            <p><strong>Revenue:</strong> {formatCurrency(experiment.revenue)}</p>
            <p><strong>Profit:</strong> {formatCurrency(experiment.profit)}</p>
            <p><strong>Conversion Rate:</strong> {experiment.conversionRate.toFixed(2)}%</p>
            <p><strong>Start Date:</strong> {new Date(experiment.startDate).toLocaleDateString()}</p>
            {experiment.endDate && <p><strong>End Date:</strong> {new Date(experiment.endDate).toLocaleDateString()}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Metrics" />
          <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
            <p><strong>Visitors:</strong> {experiment.visitors}</p>
            <p><strong>Leads:</strong> {experiment.leads}</p>
            <p><strong>Clicks:</strong> {experiment.clicks}</p>
            <p><strong>Sales:</strong> {experiment.sales}</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Results" />
          <div className="space-y-3 p-5 text-sm">
            {isEditing ? (
              <>
                <div>
                  <label className="block font-medium mb-1">Expected Result</label>
                  <textarea
                    value={editForm.expectedResult || experiment.expectedResult}
                    onChange={(e) => setEditForm({ ...editForm, expectedResult: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Actual Result</label>
                  <textarea
                    value={editForm.actualResult || experiment.actualResult || ""}
                    onChange={(e) => setEditForm({ ...editForm, actualResult: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2"
                    rows={2}
                  />
                </div>
              </>
            ) : (
              <>
                <p><strong>Expected Result:</strong> {experiment.expectedResult}</p>
                {experiment.actualResult && <p><strong>Actual Result:</strong> {experiment.actualResult}</p>}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}