"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { opportunityRepository, handoffRepository } from "@/lib/repositories";
import type { Opportunity, HandoffRecord } from "@/lib/types";
import { Badge, Card, Button, statusBadgeClass } from "@/components/ui";
import { OpportunityPortfolioPanel } from "@/components/OpportunityPortfolioPanel";
import { AutonomousOperatingLoopPanel } from "@/components/AutonomousOperatingLoopPanel";

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [halal, setHalal] = useState("ALL");
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [handoffFilter, setHandoffFilter] = useState("ALL");
  const [businessModelFilter, setBusinessModelFilter] = useState("ALL");
  const [sort, setSort] = useState("score");

  useEffect(() => {
    async function loadOpportunities() {
      const [data, rows] = await Promise.all([
        opportunityRepository.getAll(),
        handoffRepository.getAll(),
      ]);
      setOpportunities(data);
      setHandoffs(rows);
      setLoading(false);
    }
    loadOpportunities();
  }, []);

  const handoffStateByOpportunity = useMemo(() => {
    const map = new Map<string, HandoffRecord["status"][]>();
    for (const handoff of handoffs) {
      const list = map.get(handoff.opportunityId) ?? [];
      list.push(handoff.status);
      map.set(handoff.opportunityId, list);
    }
    return map;
  }, [handoffs]);

  const rows = useMemo(() => {
    const filtered = opportunities.filter((o) => {
      if (category !== "ALL" && o.category !== category) return false;
      if (status !== "ALL" && o.status !== status) return false;
      if (halal !== "ALL" && o.halalStatus !== halal) return false;
      if (businessModelFilter !== "ALL" && o.businessModel !== businessModelFilter) return false;
      const states = handoffStateByOpportunity.get(o.id);
      if (handoffFilter === "NONE" && states && states.length > 0) return false;
      if (handoffFilter !== "ALL" && handoffFilter !== "NONE" && !(states ?? []).includes(handoffFilter as HandoffRecord["status"])) return false;
      if (q && !`${o.title} ${o.targetAudience}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "demand") return b.demandScore - a.demandScore;
      if (sort === "commercial") return b.commercialIntentScore - a.commercialIntentScore;
      if (sort === "cost") return a.estimatedStartupCost - b.estimatedStartupCost;
      return b.overallScore - a.overallScore;
    });
  }, [opportunities, q, category, status, halal, businessModelFilter, handoffFilter, handoffStateByOpportunity, sort]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Opportunities</h1>
        <Link href="/opportunities/new">
          <Button>Create New Opportunity</Button>
        </Link>
      </div>
      <p className="text-sm text-slate-500">Sample data is marked with a &lsquo;Sample&rsquo; badge. All scores are recalculated automatically when fields change.</p>
      <AutonomousOperatingLoopPanel />
      <OpportunityPortfolioPanel />
      <Card className="grid gap-2 p-4 md:grid-cols-3 lg:grid-cols-4">
            <input className="rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search opportunities" />
            <select className="rounded-md border px-2 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="ALL">All categories</option>
              <option value="CHILDRENS_BOOKS">Children&apos;s books</option>
              <option value="TEACHER_RESOURCES">Teacher resources</option>
              <option value="PRINTABLES">Printables</option>
              <option value="AFFILIATE">Affiliate</option>
              <option value="DIGITAL_TOOLS">Digital tools</option>
              <option value="SAAS">SaaS</option>
            </select>
            <select className="rounded-md border px-2 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="ALL">All statuses</option>
              <option value="IDEA">Idea</option>
              <option value="RESEARCHING">Researching</option>
              <option value="VALIDATING">Validating</option>
              <option value="VALIDATED">Validated</option>
              <option value="BUILDING">Building</option>
              <option value="PUBLISHED">Published</option>
              <option value="EARNING">Earning</option>
              <option value="SCALING">Scaling</option>
              <option value="PAUSED">Paused</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select className="rounded-md border px-2 py-2 text-sm" value={halal} onChange={(e) => setHalal(e.target.value)} aria-label="Filter by halal status">
              <option value="ALL">All halal statuses</option>
              <option value="HALAL">Halal</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value="NOT_ALLOWED">Not allowed</option>
            </select>
            <select className="rounded-md border px-2 py-2 text-sm" value={businessModelFilter} onChange={(e) => setBusinessModelFilter(e.target.value)} aria-label="Filter by business model">
              <option value="ALL">All business models</option>
              <option value="DIGITAL_PRODUCT">Digital product</option>
              <option value="AFFILIATE">Affiliate</option>
              <option value="SAAS">SaaS</option>
              <option value="PRINTABLE">Printable</option>
              <option value="EDUCATIONAL">Educational</option>
              <option value="MARKETPLACE">Marketplace</option>
            </select>
            <select className="rounded-md border px-2 py-2 text-sm" value={handoffFilter} onChange={(e) => setHandoffFilter(e.target.value)} aria-label="Filter by handoff state">
              <option value="ALL">All handoff states</option>
              <option value="NONE">No handoff yet</option>
              <option value="DRAFT">Handoff draft</option>
              <option value="HANDOFF_READY">Handoff ready</option>
              <option value="ACCEPTED">Handoff accepted</option>
              <option value="REJECTED">Handoff rejected</option>
              <option value="COMPLETED">Handoff completed</option>
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
                  <Badge className="bg-slate-100 text-slate-700">{o.businessModel}</Badge>
                  {(handoffStateByOpportunity.get(o.id) ?? []).map((handoffStatus) => (
                    <Badge key={handoffStatus} className="bg-blue-50 text-blue-700">Handoff: {handoffStatus}</Badge>
                  ))}
                  <Badge className="bg-slate-100 text-slate-700">${o.estimatedStartupCost} start</Badge>
                  {/* Check if this is sample data - we'll need to track this client-side */}
                  {o.id.startsWith('opp-00') && <Badge className="bg-amber-100 text-amber-700">Sample</Badge>}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Created {new Date(o.createdAt).toLocaleDateString()} · Updated {new Date(o.updatedAt).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
          {loading ? <p className="p-4 text-center text-sm text-slate-500">Loading opportunities…</p> : null}
    </div>
  );
}