"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader } from "@/components/ui";

type Activation = {
  provider: string;
  status: string;
  capabilities: string[];
  requiredVariables: string[];
  optionalVariables: string[];
  configured: boolean;
  healthCheckRequired: boolean;
  liveTestRequired: boolean;
  approvalRequired: boolean;
  safeReason: string;
  lastHealthCheckAt: string | null;
};

type ActivationResponse = { activations: Activation[] };

function statusClass(status: string): string {
  if (status === "HEALTHY") return "bg-emerald-100 text-emerald-800";
  if (status === "DEGRADED" || status === "RATE_LIMITED") return "bg-amber-100 text-amber-800";
  if (["AUTH_FAILED", "CREDIT_LIMITED", "UNAVAILABLE"].includes(status)) return "bg-red-100 text-red-800";
  if (status === "DISABLED" || status === "NOT_CONFIGURED") return "bg-slate-100 text-slate-700";
  return "bg-sky-100 text-sky-800";
}

export function ProviderActivationPanel() {
  const [data, setData] = useState<ActivationResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/activation")
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<ActivationResponse>;
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (unavailable) {
    return (
      <Card>
        <CardHeader title="LIVE PROVIDER ACTIVATION" subtitle="Activation metadata is unavailable." />
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card>
      <CardHeader
        title="LIVE PROVIDER ACTIVATION"
        subtitle="Safe activation metadata only. Configuration is not health; no provider calls are made here."
      />
      <div className="grid gap-3 p-5 lg:grid-cols-2">
        {data.activations.map((activation) => (
          <div key={activation.provider} className="rounded-md border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{activation.provider}</h3>
              <Badge className={statusClass(activation.status)}>{activation.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-700">{activation.safeReason}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activation.capabilities.map((capability) => (
                <span key={capability} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                  {capability}
                </span>
              ))}
            </div>
            <dl className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div><dt className="font-medium">Configuration:</dt> <dd>{activation.configured ? "Configured" : "Credential not configured"}</dd></div>
              <div><dt className="font-medium">Health check:</dt> <dd>{activation.healthCheckRequired ? "Required" : "Not required / previously completed"}</dd></div>
              <div><dt className="font-medium">Live test:</dt> <dd>{activation.liveTestRequired ? "Required after health check" : "Not ready yet"}</dd></div>
              <div><dt className="font-medium">Approval:</dt> <dd>{activation.approvalRequired ? "Required" : "Not required for declared capabilities"}</dd></div>
            </dl>
            {activation.requiredVariables.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Required server-side variables: {activation.requiredVariables.join(", ")}
              </p>
            )}
            {activation.optionalVariables.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Optional variables: {activation.optionalVariables.join(", ")}
              </p>
            )}
            {activation.lastHealthCheckAt && (
              <p className="mt-2 text-xs text-slate-500">Last real health check: {new Date(activation.lastHealthCheckAt).toLocaleString()}</p>
            )}
            <p className="mt-2 text-xs font-medium text-slate-700">Safe next step: {activation.safeReason}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
