/**
 * Phase 17 — pure live research-cycle planning.
 *
 * The execution service uses this plan to select only providers that have a
 * real successful health check. It intentionally does not implement a second
 * research pipeline: the server service passes the selected providers to the
 * existing runResearch orchestrator and persists the existing ResearchRun shape.
 */

import { createHash } from "node:crypto";
import type { ProviderActivation } from "./provider-activation";

export const LIVE_RESEARCH_PROVIDERS = ["brave", "reddit", "google-trends"] as const;
export type LiveResearchProvider = (typeof LIVE_RESEARCH_PROVIDERS)[number];

export interface LiveResearchPlan {
  researchProviders: LiveResearchProvider[];
  activationProviders: string[];
  skipped: Array<{ provider: string; state: string; reason: string }>;
}

const ACTIVATION_TO_RESEARCH: Record<string, LiveResearchProvider> = {
  "brave-search": "brave",
  reddit: "reddit",
  "google-trends": "google-trends",
};

export function activationNameForResearchProvider(provider: LiveResearchProvider): string {
  return provider === "brave" ? "brave-search" : provider;
}

export function planLiveResearchCycle(
  activations: readonly ProviderActivation[],
  selectedProviders?: readonly string[],
): LiveResearchPlan {
  const requested = selectedProviders?.length
    ? new Set(selectedProviders.map((provider) => ACTIVATION_TO_RESEARCH[provider] ?? provider as LiveResearchProvider))
    : null;
  const researchProviders: LiveResearchProvider[] = [];
  const activationProviders: string[] = [];
  const skipped: LiveResearchPlan["skipped"] = [];

  for (const provider of LIVE_RESEARCH_PROVIDERS) {
    const activationName = activationNameForResearchProvider(provider);
    if (requested && !requested.has(provider)) {
      skipped.push({ provider, state: "NOT_SELECTED", reason: "Provider was not selected for this cycle." });
      continue;
    }
    const activation = activations.find((candidate) => candidate.provider === activationName);
    if (!activation) {
      skipped.push({ provider, state: "NOT_CONFIGURED", reason: "Provider is not represented in the activation registry." });
      continue;
    }
    if (!activation.configured || activation.status === "NOT_CONFIGURED" || activation.status === "DISABLED") {
      skipped.push({ provider, state: activation.status, reason: activation.safeReason });
      continue;
    }
    // The server service performs the real health check after planning. A
    // provider is therefore eligible for the cycle when configured, but the
    // final list is filtered again by the controller's successful HEALTHY
    // state before any research query runs.
    researchProviders.push(provider);
    activationProviders.push(activationName);
  }

  return { researchProviders, activationProviders, skipped };
}

/** Stable request-to-run key; the ResearchRun primary key prevents duplicate persistence. */
export function buildLiveResearchRunId(ownerId: string, opportunityId: string, requestId: string): string {
  const digest = createHash("sha256")
    .update(`${ownerId}:${opportunityId}:${requestId}`)
    .digest("hex")
    .slice(0, 32);
  return `live-research-${digest}`;
}
