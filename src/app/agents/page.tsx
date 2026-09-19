"use client";

import { useEffect, useState } from "react";
import { agentRepository } from "@/lib/repositories";
import type { Agent } from "@/lib/types";
import { Badge, Card } from "@/components/ui";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await agentRepository.getAll();
      setAgents(data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">AI Agents</h1>
      <p className="text-sm text-slate-500">Architecture placeholders only. None are connected to live AI APIs.</p>
      {loading ? <p className="text-sm text-slate-500">Loading agents...</p> : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{a.name}</div>
              <Badge className="bg-slate-100 text-slate-700">{a.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">{a.description}</p>
            <p className="mt-2 text-xs text-slate-500">PLANNED INTEGRATION</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
