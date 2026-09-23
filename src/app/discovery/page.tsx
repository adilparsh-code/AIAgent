"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, statusBadgeClass } from "@/components/ui";
import { formatRelativeTime } from "@/lib/format";
import { DISCOVERY_CATEGORIES, type DiscoveryCategory, type DiscoveryRunResult } from "@/lib/discovery-types";

const CATEGORY_LABELS: Record<DiscoveryCategory, string> = {
  "digital-products": "Digital products",
  apps: "Apps",
  affiliate: "Affiliate",
  education: "Education",
  "pinterest-content": "Pinterest / content",
  saas: "SaaS / micro-SaaS",
  "ai-tools": "AI tools",
  "childrens-activities": "Children's activities",
  other: "Other legitimate",
};

export default function DiscoveryPage() {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState<DiscoveryCategory>("education");
  const [runs, setRuns] = useState<DiscoveryRunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRuns() {
    try {
      const response = await fetch("/api/discovery?limit=20", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load discovery runs");
      }
      setRuns(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load discovery runs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, category, maxCandidates: 5 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Discovery failed");
      }
      setTopic("");
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Discovery</h1>
        <p className="mt-1 text-sm text-slate-600">
          AIAgent does not invent income ideas. It generates research candidates, collects real evidence,
          and asks: is there enough evidence that this opportunity deserves implementation?
        </p>
      </div>

      <Card>
        <CardHeader
          title="Start a discovery run"
          subtitle="Discovery → Research → Validation → Score → Ranked opportunities → Handoff ready"
        />
        <form onSubmit={handleStart} className="grid gap-3 p-5 md:grid-cols-3">
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium">Topic</span>
            <input
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. teacher worksheets"
              minLength={3}
              maxLength={240}
              required
              aria-label="Discovery topic"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Category</span>
            <select
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as DiscoveryCategory)}
              aria-label="Discovery category"
            >
              {DISCOVERY_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {CATEGORY_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-3">
            <Button type="submit" disabled={starting || topic.trim().length < 3}>
              {starting ? "Researching candidates…" : "Start discovery"}
            </Button>
          </div>
        </form>
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Discovery error:</strong> {error}
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recent runs</h2>
        {loading ? (
          <Card className="p-6 text-center text-sm text-slate-500">Loading discovery runs…</Card>
        ) : runs.length === 0 ? (
          <Card className="p-6 text-sm text-slate-500">No discovery runs yet.</Card>
        ) : (
          runs.map((run) => (
            <Card key={run.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/discovery/${run.id}`} className="font-semibold text-blue-700">
                    {run.topic}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {run.category} · {formatRelativeTime(run.completedAt ?? run.startedAt)} · {run.researchedCount} researched ·{" "}
                    {run.readyForHandoffCount} handoff-ready
                  </p>
                </div>
                <Badge className={statusBadgeClass(run.status)}>{run.status}</Badge>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
