import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

/**
 * Phase 9 — data-class label. Real measurements, model output, explicit
 * estimates and sample/dry-run rows are always visually distinct so a real
 * number can never be mistaken for a generated or simulated one.
 */
export function dataClassBadgeClass(dataClass: string | null | undefined): string {
  switch (dataClass) {
    case "REAL_DATA":
    case "REAL_LIVE_DATA":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "AI_GENERATED":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "AI_ESTIMATE":
    case "ESTIMATED_DATA":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "SAMPLE_DATA":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-slate-50 text-slate-500 border-slate-200";
  }
}

export function dataClassLabel(dataClass: string | null | undefined): string {
  switch (dataClass) {
    case "REAL_DATA":
    case "REAL_LIVE_DATA":
      return "REAL DATA";
    case "AI_GENERATED":
      return "AI GENERATED";
    case "AI_ESTIMATE":
    case "ESTIMATED_DATA":
      return "ESTIMATED DATA";
    case "SAMPLE_DATA":
      return "SAMPLE / DRY RUN";
    default:
      return "—";
  }
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

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: string; action?: React.ReactNode }) {
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

export function Button({ 
  className, 
  children, 
  onClick, 
  type = "button",
  variant = "primary",
  disabled = false
}: { 
  className?: string; 
  children: React.ReactNode; 
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const baseClasses = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50";
  
  const variantClasses = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };

  return (
    <button
      type={type}
      className={cn(baseClasses, variantClasses[variant], className)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}