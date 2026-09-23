"use client";

import { useEffect, useState } from "react";

type Task = { id:string; taskType:string; objective:string; status:string; requiresApproval:boolean; approvalState:string|null };
export default function ApprovalsPage() {
  const [tasks,setTasks]=useState<Task[]>([]);
  const load=()=>fetch("/api/agent-tasks?status=WAITING_APPROVAL&limit=100").then(r=>r.json()).then(setTasks);
  useEffect(()=>{load()},[]);
  async function act(id:string, action:"approve"|"reject"){
    await fetch(`/api/agent-tasks/${id}/${action}`,{method:"POST",headers:{"content-type":"application/json"},body:action==="reject"?JSON.stringify({reason:"Rejected from approvals console"}):"{}"});
    load();
  }
  return <main className="mx-auto max-w-5xl p-8"><h1 className="text-3xl font-bold">Approvals</h1><p className="mt-2 text-slate-600">Explicit human gate for tasks that may carry budget or future external side effects.</p><div className="mt-6 space-y-4">{tasks.length===0?<p>No pending approvals.</p>:tasks.map(t=><div key={t.id} className="rounded-xl border p-5"><div className="flex justify-between"><strong>{t.taskType}</strong><span>{t.status}</span></div><p className="mt-2">{t.objective}</p><div className="mt-4 flex gap-2"><button className="rounded bg-black px-4 py-2 text-white" onClick={()=>act(t.id,"approve")}>Approve</button><button className="rounded border px-4 py-2" onClick={()=>act(t.id,"reject")}>Reject</button></div></div>)}</div></main>;
}
