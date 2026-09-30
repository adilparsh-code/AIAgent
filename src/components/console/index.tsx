"use client";

/**
 * Operational console primitives — Phase 13 (AI Income Lab compatibility).
 *
 * Reusable, presentational building blocks for an operations console. The
 * intent is that these components can later be lifted into AI Income Lab's
 * operational UI unchanged, so they deliberately:
 *
 *   - contain NO business logic (all decisions arrive as props);
 *   - contain NO AIAgent-specific hard-coded assumptions (labels, statuses
 *     and values are inputs, not constants);
 *   - never fetch data, never fabricate values, never render fake success.
 *
 * They layer on top of the existing hand-rolled UI kit in `@/components/ui`
 * (Badge, Card, CardHeader) and the existing Tailwind palette conventions
 * (slate surfaces, emerald/sky/amber/red status tones). No new dependencies.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, CardHeader } from "@/components/ui";

// ---------------------------------------------------------------------------
// Status tones
// ---------------------------------------------------------------------------

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
};

/**
 * Shared status → tone mapping used across the console. Unknown statuses map
 * to `neutral` — an unrecognized state must never be painted as healthy.
 */
export function statusTone(status: string | null | undefined): StatusTone {
  switch (status) {
    // Terminal-positive outcomes
    case "DELIVERED":
    case "ACCEPTED":
    case "COMPLETED":
    case "VALIDATED":
    case "SUPPORTED":
    case "HALAL":
    case "HEALTHY":
    case "PUBLISHED":
    case "EARNING":
    case "SCALING":
    case "WIN":
      return "success";
    // In-progress / informational
    case "PENDING":
    case "RUNNING":
    case "RESEARCHING":
    case "VALIDATING":
    case "BUILDING":
    case "ACTIVE":
    case "HANDOFF_READY":
    case "DUPLICATE":
    case "MIXED":
    case "READY":
      return "info";
    // Needs attention
    case "REVIEW_REQUIRED":
    case "REQUIRES_HUMAN_REVIEW":
    case "NEEDS_HUMAN_REVIEW":
    case "DEGRADED":
    case "PARTIAL":
    case "PROMISING":
    case "RATE_LIMITED":
    case "PAUSED":
    case "PAUSE":
    case "WAITING_APPROVAL":
      return "warning";
    // Negative / failed
    case "REJECTED":
    case "FAILED":
    case "BLOCKED":
    case "NOT_ALLOWED":
    case "ADAPTATION_REFUSED":
    case "AUTH_REJECTED":
    case "AUTH_FAILED":
    case "CREDIT_LIMITED":
    case "UNAVAILABLE":
    case "CONTRADICTED":
    case "TIMEOUT":
    case "CANCELLED":
    case "KILL":
    case "STOP":
      return "danger";
    // Absent/unknown configuration or state — explicitly NOT healthy
    case "NOT_CONFIGURED":
    case "UNKNOWN":
    case "INSUFFICIENT":
    case "INSUFFICIENT_EVIDENCE":
    case "UNCONFIGURED":
    case "DRAFT":
    case "READY_FOR_HEALTH_CHECK":
    case "CONFIGURED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  /** Raw backend status value. Rendered verbatim — never rewritten. */
  status: string | null | undefined;
  /** Optional display override; the raw status stays the default. */
  label?: string;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label ?? (status ?? "—")}
    </span>
  );
}

/**
 * Status dot + label for dense tables where a full badge is too wide.
 */
export function StatusDot({ status, label }: { status: string | null | undefined; label?: string }) {
  const tone = statusTone(status);
  const dot =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "info"
        ? "bg-sky-500"
        : tone === "warning"
          ? "bg-amber-500"
          : tone === "danger"
            ? "bg-red-500"
            : "bg-slate-400";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      {label ?? (status ?? "—")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metric + dashboard cards
// ---------------------------------------------------------------------------

export function MetricCard({
  label,
  value,
  hint,
  loading = false,
  href,
}: {
  label: string;
  /** Already-formatted value string. The card never formats business data itself. */
  value: string | null | undefined;
  hint?: string;
  loading?: boolean;
  href?: string;
}) {
  const body = (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
        {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-slate-100" /> : value ?? "Data unavailable"}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </Card>
  );
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  );
}

export function DashboardCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <MinusCircle className="h-6 w-6 text-slate-300" aria-hidden />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden />
      <p className="text-sm font-medium text-red-700">{title}</p>
      {message ? <p className="max-w-md text-xs text-slate-500">{message}</p> : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-slate-500" role="status">
      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data table
// ---------------------------------------------------------------------------

export interface DataTableColumn<Row> {
  /** Stable key; also the default aria-safe header id. */
  key: string;
  header: React.ReactNode;
  /** Render one cell. Receives the row. Keep cells presentational. */
  render: (row: Row) => React.ReactNode;
  /** Optional className applied to every cell in this column. */
  className?: string;
  /** Visually hide the header cell on small screens (mobile card layouts). */
  hideHeaderOnMobile?: boolean;
}

/**
 * Generic presentational table. Sorting/filtering stay in the caller — this
 * component only renders what it is given.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  loading = false,
  error,
  onRetry,
  mobileCard,
}: {
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Renders each row as a bordered card list on small screens. */
  mobileCard?: (row: Row) => React.ReactNode;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" description="No records are available to display." />}</>;
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-5 py-3 font-medium">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-5 py-3 align-middle", column.className)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="space-y-2 p-3 md:hidden">
        {rows.map((row) => (
          <div key={rowKey(row)} className="rounded-lg border border-slate-100 p-3">
            {mobileCard ? (
              mobileCard(row)
            ) : (
              <dl className="space-y-1.5">
                {columns.map((column) => (
                  <div key={column.key} className="flex items-start justify-between gap-3">
                    <dt className="text-xs text-slate-400">{column.header}</dt>
                    <dd className={cn("text-right text-sm", column.className)}>{column.render(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function HealthCard({
  name,
  status,
  message,
  detail,
}: {
  name: string;
  /** One of the system's health vocabulary values, rendered verbatim. */
  status: string | null | undefined;
  message?: string | null;
  detail?: React.ReactNode;
}) {
  const tone = statusTone(status);
  const icon =
    tone === "success" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
    ) : tone === "warning" ? (
      <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
    ) : tone === "danger" ? (
      <XCircle className="h-4 w-4 text-red-500" aria-hidden />
    ) : tone === "info" ? (
      <RefreshCw className="h-4 w-4 text-sky-500" aria-hidden />
    ) : (
      <HelpCircle className="h-4 w-4 text-slate-400" aria-hidden />
    );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {icon}
          {name}
        </div>
        <StatusBadge status={status} />
      </div>
      {message ? <p className="mt-2 text-xs text-slate-500">{message}</p> : null}
      {detail}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handoff lifecycle
// ---------------------------------------------------------------------------

export interface HandoffLifecycleStep {
  /** Stage name, e.g. "Opportunity", "Adapter", "AI Income Lab Receiver". */
  name: string;
  /** Backend-provided state for this stage; rendered verbatim. */
  status: string | null | undefined;
  /** Safe, backend-derived detail (no secrets). */
  detail?: string | null;
  /** True when this stage is the furthest one that produced information. */
  current?: boolean;
}

export const HANDOFF_LIFECYCLE_STAGES = [
  "Opportunity",
  "Eligibility",
  "Adapter",
  "Wire Envelope",
  "Transport",
  "AI Income Lab Receiver",
  "Job Run",
] as const;

export function HandoffTimeline({ steps }: { steps: HandoffLifecycleStep[] }) {
  return (
    <ol className="relative space-y-0 border-l border-slate-200 pl-5">
      {steps.map((step, index) => {
        const tone = statusTone(step.status);
        const dot =
          tone === "success"
            ? "bg-emerald-500"
            : tone === "info"
              ? "bg-sky-500"
              : tone === "warning"
                ? "bg-amber-500"
                : tone === "danger"
                  ? "bg-red-500"
                  : "bg-slate-300";
        return (
          <li key={`${step.name}-${index}`} className={cn("relative pb-5", index === steps.length - 1 && "pb-0")}>
            <span
              className={cn(
                "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white",
                dot,
                step.current && "h-3 w-3 -left-[27px]",
              )}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{step.name}</span>
              <StatusBadge status={step.status} />
              {step.current ? <span className="text-xs text-slate-400">· latest state</span> : null}
            </div>
            {step.detail ? <p className="mt-0.5 text-xs text-slate-500">{step.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Handoff delivery status derived for display from the persisted delivery row.
 * Presentational mapping only — the backend fields remain the source of truth
 * and are shown alongside the derived state.
 */
export function HandoffDeliveryStatus({
  status,
  duplicate,
  lastErrorCode,
}: {
  status: string | null | undefined;
  duplicate?: boolean;
  lastErrorCode?: string | null;
}) {
  const derived = status === "DELIVERED" && duplicate ? "DUPLICATE" : status;
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge status={derived} />
      {lastErrorCode ? <span className="text-xs text-slate-400">{lastErrorCode}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export function EvidenceList({
  items,
}: {
  items: Array<{
    id: string;
    source: string;
    title: string;
    url?: string | null;
    snippet?: string | null;
    supports?: readonly string[];
    contradicts?: readonly string[];
    dataClass?: string | null;
    collectedAt?: string | null;
    href?: string | null;
  }>;
}) {
  if (items.length === 0) {
    return <EmptyState title="No evidence recorded" description="Evidence appears here once a research run collects it." />;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{item.source}</span>
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                {item.title}
              </a>
            ) : (
              <span className="text-sm font-medium text-slate-800">{item.title}</span>
            )}
            {item.dataClass ? <StatusBadge status={undefined} label={item.dataClass} className="bg-slate-50 text-slate-500" /> : null}
          </div>
          {item.snippet ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.snippet}</p> : null}
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
            {item.supports && item.supports.length > 0 ? <span>Supports: {item.supports.join(", ")}</span> : null}
            {item.contradicts && item.contradicts.length > 0 ? (
              <span className="text-amber-600">Contradicts: {item.contradicts.join(", ")}</span>
            ) : null}
            {item.collectedAt ? <span>{new Date(item.collectedAt).toLocaleString()}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------

export function AgentRunCard({
  run,
}: {
  run: {
    id: string;
    agentName?: string | null;
    task: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    errors?: readonly string[];
  };
}) {
  const duration =
    run.completedAt && run.startedAt
      ? (() => {
          const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
          return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : null;
        })()
      : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{run.agentName ?? "Agent"}</span>
          <span className="font-mono text-xs text-slate-400">{run.id.slice(0, 12)}</span>
        </div>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1.5 text-sm text-slate-600">{run.task}</p>
      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-400">
        <span>Started {new Date(run.startedAt).toLocaleString()}</span>
        {run.completedAt ? <span>Completed {new Date(run.completedAt).toLocaleString()}</span> : <span>Still running</span>}
        {duration ? <span>Duration {duration}</span> : null}
      </div>
      {run.errors && run.errors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-600">
          {run.errors.slice(0, 5).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm button (destructive/safe actions)
// ---------------------------------------------------------------------------

export function ConfirmButton({
  label,
  confirmTitle,
  confirmDescription,
  onConfirm,
  disabled = false,
  variant = "primary",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
}: {
  label: React.ReactNode;
  confirmTitle: string;
  confirmDescription?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mr-auto">
        <p className="text-sm font-medium text-slate-900">{confirmTitle}</p>
        {confirmDescription ? <p className="text-xs text-slate-500">{confirmDescription}</p> : null}
      </div>
      <Button
        variant="secondary"
        onClick={() => setOpen(false)}
      >
        {cancelLabel}
      </Button>
      <Button
        variant={variant === "danger" ? "danger" : "primary"}
        onClick={() => {
          setOpen(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
