import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "VALIDATED":
    case "PUBLISHED":
    case "EARNING":
    case "SCALING":
    case "COMPLETED":
    case "SCALE":
    case "HALAL":
      return "bg-emerald-100 text-emerald-800";
    case "RESEARCHING":
    case "VALIDATING":
    case "BUILDING":
    case "ACTIVE":
    case "ITERATE":
      return "bg-sky-100 text-sky-800";
    case "REVIEW_REQUIRED":
    case "PAUSED":
    case "PAUSE":
      return "bg-amber-100 text-amber-800";
    case "NOT_ALLOWED":
    case "REJECTED":
    case "KILL":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-semibold text-slate-700">{pct}</span>
    </div>
  );
}
