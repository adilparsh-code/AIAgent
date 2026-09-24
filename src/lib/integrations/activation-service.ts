import "server-only";

import type { IntegrationCapability } from "./contract";
import { getProviderChecklist, getProviderChecklistEntry } from "./provider-checklist";
import {
  deriveProviderActivations,
  type ProviderActivation,
  type ProviderActivationInput,
} from "./provider-activation";
import { listIntegrationSummaries } from "./service";

export const ACTIVATION_BOUNDS = { MAX_PROVIDERS: 32, MAX_HEALTH_ROWS: 32 } as const;

/**
 * Resolve system-level activation metadata from the existing registry and
 * IntegrationHealth records. The data is system metadata, not tenant data, so
 * the authenticated API does not need to expose or query an owner's records.
 * No provider health check or external request is performed here.
 */
export async function getProviderActivations(): Promise<ProviderActivation[]> {
  const summaries = await listIntegrationSummaries();
  const inputs: ProviderActivationInput[] = summaries
    .slice(0, ACTIVATION_BOUNDS.MAX_PROVIDERS)
    .map((summary) => {
      const checklist = getProviderChecklistEntry(summary.name);
      const capabilities = (checklist?.capabilities ?? summary.capabilities) as IntegrationCapability[];
      return {
        provider: summary.name,
        requiredEnvVars: checklist?.requiredEnvironmentVariables ?? summary.requiredEnvVars,
        optionalEnvVars: checklist?.optionalEnvironmentVariables ?? [],
        capabilities,
        configured: summary.missingEnvVars.length === 0,
        healthStatus: summary.status,
        healthCheckedAt: summary.lastCheckedAt,
        healthError: summary.lastError,
        isScaffold: summary.isScaffold || checklist?.isScaffold === true,
      };
    });

  // The agent runtime's generic OpenAI-compatible provider is an existing
  // adapter outside IntegrationRegistry. Keep it visible in activation
  // metadata, but report only configuration presence; it has no IntegrationHealth
  // row and therefore cannot be HEALTHY until a real health check is added.
  const generic = getProviderChecklistEntry("ai-provider");
  if (generic && !inputs.some((input) => input.provider === generic.provider)) {
    inputs.push({
      provider: generic.provider,
      requiredEnvVars: generic.requiredEnvironmentVariables,
      optionalEnvVars: generic.optionalEnvironmentVariables,
      capabilities: generic.capabilities,
      configured: Boolean(process.env.AI_PROVIDER_API_KEY?.trim()),
      healthStatus: null,
      healthCheckedAt: null,
      healthError: null,
      isScaffold: false,
    });
  }

  return deriveProviderActivations(inputs);
}
