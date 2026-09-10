"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SAMPLE_OPPORTUNITIES } from "@/lib/data";
import { Badge, Card, statusBadgeClass } from "@/components/ui";

export default function OpportunitiesPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [halal, setHalal] = useState("ALL");
  const [sort, setSort] = useState("score");

  const rows = useMemo(() => {
    const filtered = SAMPLE_OPPORTUNITIES.filter((o) => {
      if (category !== "ALL" && o.category !== category) return false;
      if (status !== "ALL" && o.status !== status) return false;
      if (halal !== "ALL" && o.halalStatus !== halal) return false;
      if (q && !`${o.title} ${o.targetAudience}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "demand") return b.demandScore - a.demandScore;
      if (sort === "commercial") return b.commercialIntentScore - a.commercialIntentScore;
      if (sort === "cost") return a.estimatedStartupCost - b.estimatedStartupCost;
      return b.overallScore - a.overallScore;
    });
  }, [q, category, status, halal, sort]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Opportunities</h1>
      <p className="text-sm text-slate-500">SAMPLE DATA — scores are illustrative AI ESTIMATEs, not market research.</p>
      <Card className="grid gap-2 p-4 md:grid-cols-5">
        <input className="rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search opportunities" />
        <select className="rounded-md border px-2 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="ALL">All categories</option>
          <option value="CHILDRENS_BOOKS">Children&apos;s books</option>
          <option value="TEACHER_RESOURCES">Teacher resources</option>
          <option value="EDUCATIONAL_RESOURCES">Educational resources</option>
          <option value="AFFILIATE">Affiliate</option>
          <option value="DIGITAL_TOOLS">Digital tools</option>
        </select>
        <select className="rounded-md border px-2 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="ALL">All statuses</option>
          <option value="IDEA">Idea</option>
          <option value="RESEARCHING">Researching</option>
          <option value="VALIDATED">Validated</option>
        </select>
        <select className="rounded-md border px-2 py-2 text-sm" value={halal} onChange={(e) => setHalal(e.target.value)} aria-label="Filter by halal status">
          <option value="ALL">All halal statuses</option>
          <option value="HALAL">Halal</option>
          <option value="REVIEW_REQUIRED">Review required</option>
          <option value="NOT_ALLOWED">Not allowed</option>
        </select>
        <select className="rounded-md border px-2 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort opportunities">
          <option value="score">Sort: Overall score</option>
          <option value="demand">Sort: Demand</option>
          <option value="commercial">Sort: Commercial intent</option>
          <option value="cost">Sort: Startup cost</option>
        </select>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((o) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/opportunities/${o.id}`} className="font-semibold text-blue-700">{o.title}</Link>
              <span className="text-lg font-bold">{o.overallScore.toFixed(1)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{o.problemSolved}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className={statusBadgeClass(o.status)}>{o.status}</Badge>
              <Badge className={statusBadgeClass(o.halalStatus)}>{o.halalStatus}</Badge>
              <Badge className="bg-slate-100 text-slate-700">${o.estimatedStartupCost} start</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
