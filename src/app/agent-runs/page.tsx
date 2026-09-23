"use client";

import { useEffect,useState } from "react";
type Run={id:string;agentName:string;task:string;status:string;startedAt:string;completedAt:string|null;errors:string[]};
export default function AgentRunsPage(){
 const [runs,setRuns]=useState<Run[]>([]);
 useEffect(()=>{fetch("/api/agent-runs?limit=100").then(r=>r.json()).then(setRuns)},[]);
 return <main className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-bold">Agent Runs</h1><p className="mt-2 text-slate-600">Execution history without exposing hidden reasoning.</p><div className="mt-6 overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Agent</th><th className="p-3">Task</th><th className="p-3">Status</th><th className="p-3">Started</th><th className="p-3">Errors</th></tr></thead><tbody>{runs.map(r=><tr key={r.id} className="border-b last:border-0"><td className="p-3">{r.agentName}</td><td className="p-3">{r.task}</td><td className="p-3">{r.status}</td><td className="p-3">{new Date(r.startedAt).toLocaleString()}</td><td className="p-3">{r.errors.join("; ")}</td></tr>)}</tbody></table></div></main>;
}
