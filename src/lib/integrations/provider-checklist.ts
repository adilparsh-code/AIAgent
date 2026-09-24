/**
 * Phase 15 — activation checklist for providers already represented by the
 * repository. This is metadata only: it does not read environment values,
 * call providers, or perform execution.
 */

import type { IntegrationCapability, IntegrationType } from "./contract";
import { SCAFFOLD_SPECS } from "./adapters/scaffolds";
import { SAMBANOVA_ENV_VARS, SAMBANOVA_OPTIONAL_ENV_VARS } from "./adapters/sambanova";

export type ExecutionRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ProviderChecklistEntry {
  provider: string;
  integrationType: IntegrationType;
  requiredEnvironmentVariables: readonly string[];
  optionalEnvironmentVariables: readonly string[];
  capabilities: readonly IntegrationCapability[];
  requiredPermissions: readonly IntegrationCapability[];
  healthCheckRequired: boolean;
  liveTestRequired: boolean;
  executionRisk: ExecutionRiskLevel;
  credentialRequired: boolean;
  isScaffold: boolean;
}

const CHECKLIST: readonly ProviderChecklistEntry[] = [
  {
    provider: "sambanova",
    integrationType: "AI_PROVIDER",
    requiredEnvironmentVariables: SAMBANOVA_ENV_VARS,
    optionalEnvironmentVariables: SAMBANOVA_OPTIONAL_ENV_VARS,
    capabilities: ["READ_DATA", "CREATE_DRAFT"],
    requiredPermissions: ["READ_DATA", "CREATE_DRAFT"],
    healthCheckRequired: true,
    liveTestRequired: true,
    executionRisk: "MEDIUM",
    credentialRequired: true,
    isScaffold: false,
  },
  {
    provider: "ai-provider",
    integrationType: "AI_PROVIDER",
    requiredEnvironmentVariables: ["AI_PROVIDER_API_KEY"],
    optionalEnvironmentVariables: ["AI_PROVIDER_BASE_URL", "AI_PROVIDER_MODEL", "AI_PROVIDER_NAME", "AI_PROVIDER_ENV"],
    capabilities: ["READ_DATA", "CREATE_DRAFT"],
    requiredPermissions: ["READ_DATA", "CREATE_DRAFT"],
    healthCheckRequired: true,
    liveTestRequired: true,
    executionRisk: "MEDIUM",
    credentialRequired: true,
    isScaffold: false,
  },
  {
    provider: "brave-search",
    integrationType: "RESEARCH",
    requiredEnvironmentVariables: ["BRAVE_SEARCH_API_KEY"],
    optionalEnvironmentVariables: ["RESEARCH_PROVIDER_ENV"],
    capabilities: ["SEARCH", "READ_DATA"],
    requiredPermissions: ["SEARCH", "READ_DATA"],
    healthCheckRequired: true,
    liveTestRequired: true,
    executionRisk: "LOW",
    credentialRequired: true,
    isScaffold: false,
  },
  {
    provider: "reddit",
    integrationType: "RESEARCH",
    requiredEnvironmentVariables: [],
    optionalEnvironmentVariables: ["RESEARCH_PROVIDER_ENV"],
    capabilities: ["SEARCH", "READ_DATA"],
    requiredPermissions: ["SEARCH", "READ_DATA"],
    healthCheckRequired: true,
    liveTestRequired: true,
    executionRisk: "LOW",
    credentialRequired: false,
    isScaffold: false,
  },
  {
    provider: "google-trends",
    integrationType: "RESEARCH",
    requiredEnvironmentVariables: ["SERPAPI_API_KEY"],
    optionalEnvironmentVariables: ["RESEARCH_PROVIDER_ENV"],
    capabilities: ["SEARCH", "READ_DATA"],
    requiredPermissions: ["SEARCH", "READ_DATA"],
    healthCheckRequired: true,
    liveTestRequired: true,
    executionRisk: "LOW",
    credentialRequired: true,
    isScaffold: false,
  },
  ...SCAFFOLD_SPECS.map(
    (spec): ProviderChecklistEntry => ({
      provider: spec.name,
      integrationType: spec.type,
      requiredEnvironmentVariables: spec.requiredEnvVars,
      optionalEnvironmentVariables: [],
      capabilities: spec.capabilities,
      requiredPermissions: spec.capabilities,
      healthCheckRequired: false,
      liveTestRequired: false,
      executionRisk: "MEDIUM",
      credentialRequired: spec.requiredEnvVars.length > 0,
      isScaffold: true,
    }),
  ),
];

export function getProviderChecklist(): readonly ProviderChecklistEntry[] {
  return CHECKLIST;
}

export function getProviderChecklistEntry(provider: string): ProviderChecklistEntry | null {
  return CHECKLIST.find((entry) => entry.provider === provider) ?? null;
}
