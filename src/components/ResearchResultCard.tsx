"use client";

import { Badge, Card, CardHeader } from "./ui";
import { formatRelativeTime } from "@/lib/format";
import type { ResearchRun, ValidationSignal } from "@/lib/research-types";

function signalBadgeClass(status: ValidationSignal["status"]): string {
  switch (status) {
    case "SUPPORTED":
      return "bg-emerald-100 text-emerald-800";
    case "MIXED":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function providerStatusBadgeClass(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "bg-emerald-100 text-emerald-800";
    case "EMPTY":
      return "bg-sky-100 text-sky-800";
    case "CONFIG_ERROR":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-red-100 text-red-800";
  }
}

const CONCLUSION_CLASS: Record<string, string> = {
  VALIDATED: "bg-emerald-100 text-emerald-800",
  PROMISING: "bg-sky-100 text-sky-800",
  INSUFFICIENT_EVIDENCE: "bg-slate-100 text-slate-700",
  CONTRADICTED: "bg-orange-100 text-orange-800",
  REQUIRES_HUMAN_REVIEW: "bg-amber-100 text-amber-800",
  REJECTED: "bg-red-100 text-red-800",
};

const FACTOR_STATUS_LABEL: Record<string, string> = {
  "research-supported": "research-supported",
  "research-unsupported": "research-unsupported",
  "insufficient-evidence": "insufficient evidence",
  "human-review-required": "human review required",
  unchanged: "unchanged (not research-informable)",
};

export function ResearchResultCard({ run }: { run: ResearchRun }) {
  const succeeded = run.providersSucceeded.length;
  const attempted = run.providersAttempted.length;

  return (
    <Card>
      <CardHeader
        title={`Research run ${run.id}`}
        subtitle={`Run at ${formatRelativeTime(run.completedAt ?? run.startedAt)} · ${run.evidence.length} evidence · confidence ${(run.confidence * 100).toFixed(0)}% · status ${run.status}`}
        action={<Badge className={CONCLUSION_CLASS[run.conclusion] ?? "bg-slate-100 text-slate-700"}>{run.conclusion}</Badge>}
      />
      <div className="space-y-5 p-5 text-sm">
        <p className="rounded-md bg-slate-50 p-3 text-slate-700">
          <strong>Conclusion basis:</strong> {run.conclusionBasis || "No basis recorded."}
        </p>

        <div>
          <h3 className="mb-2 font-semibold">Providers ({succeeded}/{attempted} succeeded)</h3>
          {run.providerStatuses.length ? (
            <ul className="space-y-1">
              {run.providerStatuses.map((provider) => (
                <li key={provider.name} className="flex flex-wrap items-center gap-2">
                  <Badge className={providerStatusBadgeClass(provider.status)}>{provider.status}</Badge>
                  <span className="font-medium">{provider.name}</span>
                  {provider.evidenceCount > 0 && <span className="text-xs text-slate-500">{provider.evidenceCount} evidence</span>}
                  {provider.error && <span className="text-xs text-amber-700">{provider.error}</span>}
                  {provider.status === "CONFIG_ERROR" && (
                    <span className="text-xs text-slate-500">(provider unavailable/not configured — no data invented)</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">No provider attempted.</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Validation signals</h3>
          {run.validationSignals.length ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {run.validationSignals.map((signal) => (
                <li key={signal.key} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{signal.label}</span>
                    <Badge className={signalBadgeClass(signal.status)}>{signal.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{signal.basis}</p>
                  <p className="mt-1 text-xs text-slate-400">{signal.evidenceIds.length} evidence item(s) traced</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">No validation signals — run produced no usable evidence.</p>
          )}
        </div>

        {run.errors.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <strong>Errors / warnings:</strong>
            <ul className="mt-1 list-disc pl-5">
              {run.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-2 font-semibold">Research → scoring guidance</h3>
          <p className="mb-2 text-xs text-slate-500">
            {run.scoreIntegration.suggestedOverallScore !== null
              ? `Evidence-based suggested overall score: ${run.scoreIntegration.suggestedOverallScore}/100 (suggestion only — not applied automatically).`
              : run.scoreIntegration.note ?? "No score suggested — not enough research-supported factors."}
          </p>
          <ul className="grid gap-1 md:grid-cols-2">
            {run.scoreIntegration.factors.map((factor) => (
              <li key={factor.key} className="rounded border px-3 py-2">
                <span className="font-medium">{factor.key}</span>: {FACTOR_STATUS_LABEL[factor.status] ?? factor.status}
                <p className="text-xs text-slate-500">{factor.basis}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Findings</h3>
          {run.findings.length ? (
            <ul className="space-y-3">
              {run.findings.map((finding) => (
                <li key={finding.id} className="rounded-md border p-3">
                  <p className="font-medium">{finding.claim}</p>
                  <p className="mt-1 text-slate-600">{finding.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Confidence {(finding.confidence * 100).toFixed(0)}% · {finding.evidenceIds.length} supporting result(s)
                  </p>
                  {finding.contradictions.length > 0 && (
                    <div className="mt-2 rounded-md border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">
                      <strong>Contradictions preserved:</strong> {finding.contradictions.join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">No evidence was returned. Do not treat the opportunity as validated.</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Evidence ({run.evidence.length})</h3>
          {run.evidence.length ? (
            <ul className="space-y-2">
              {run.evidence.map((item) => (
                <li key={item.id} className="rounded-md border p-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {item.title}
                  </a>
                  <Badge className="ml-2 bg-slate-100 text-slate-600">{item.dataClass}</Badge>
                  <p className="mt-1 text-slate-600">{item.snippet}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Source: {item.source} · Quality {(item.qualityScore * 100).toFixed(0)}% · Collected {formatRelativeTime(item.collectedAt)}
                  </p>
                  {item.contradicts.length > 0 && (
                    <p className="mt-1 text-xs text-orange-700">Contradicts: {item.contradicts.join(" · ")}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">
              No evidence collected. Provider status above shows exactly which provider was unavailable or failed.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
