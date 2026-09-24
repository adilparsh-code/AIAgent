import {
  type AdapterConfig,
  type ExecutionContext,
  type ExecutionResult,
  type HealthCheckResult,
  type IntegrationAdapter,
  type IntegrationCapability,
  type IntegrationType,
} from "../contract";

/**
 * Phase 8 — scaffold adapters. These declare a future integration slot so
 * the registry/UI/permission model can represent it honestly TODAY:
 *
 * - No credentials exist yet → healthCheck() returns NOT_CONFIGURED.
 * - No API integration is written yet → execute() returns BLOCKED with an
 *   explicit "not implemented" error (UNSUPPORTED semantics). It never
 *   pretends success and never performs any external call.
 *
 * A scaffold becomes a real adapter only when someone implements a real
 * healthCheck probe + allowlisted actions against the provider API.
 */

export interface ScaffoldSpec {
  name: string;
  type: IntegrationType;
  description: string;
  capabilities: readonly IntegrationCapability[];
  requiredEnvVars: readonly string[];
}

/**
 * Approval-requiring capabilities (PUBLISH / SEND_MESSAGE / CREATE_CAMPAIGN /
 * SPEND_MONEY) are intentionally NOT granted to scaffolds: they would be
 * inert (execute is BLOCKED), but the capability model must not advertise
 * permissions that no real integration can honor yet.
 */
export const SCAFFOLD_SPECS: readonly ScaffoldSpec[] = [
  {
    name: "pinterest",
    type: "SOCIAL",
    description: "Pinterest content publishing and pin analytics (planned; no API integration yet).",
    capabilities: ["READ_DATA", "CREATE_DRAFT", "UPLOAD"],
    requiredEnvVars: ["PINTEREST_ACCESS_TOKEN"],
  },
  {
    name: "youtube",
    type: "CONTENT",
    description: "YouTube publishing and channel analytics (planned; no API integration yet).",
    capabilities: ["READ_DATA", "CREATE_DRAFT", "UPLOAD"],
    requiredEnvVars: ["YOUTUBE_API_KEY"],
  },
  {
    name: "affiliate-network",
    type: "AFFILIATE",
    description:
      "Affiliate network reporting (clicks/conversions/commissions) and link tracking (planned; provider TBD).",
    capabilities: ["READ_DATA"],
    requiredEnvVars: ["AFFILIATE_NETWORK_API_KEY"],
  },
  {
    name: "marketplace",
    type: "MARKETPLACE",
    description: "Digital marketplace listings and sales reporting (planned; provider TBD).",
    capabilities: ["READ_DATA", "CREATE_DRAFT"],
    requiredEnvVars: ["MARKETPLACE_API_KEY"],
  },
  {
    name: "analytics-platform",
    type: "ANALYTICS",
    description: "Website analytics import (visits, sources, conversions) (planned; provider TBD).",
    capabilities: ["READ_DATA"],
    requiredEnvVars: ["ANALYTICS_PLATFORM_API_KEY"],
  },
];

function notConfiguredResult(spec: ScaffoldSpec, action: string): ExecutionResult {
  const startedAt = new Date().toISOString();
  return {
    status: "BLOCKED",
    provider: spec.name,
    action,
    externalId: null,
    output: null,
    rawDataAvailable: false,
    dataClass: "REAL_DATA",
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    error: `${spec.name}: integration is not implemented yet (scaffold only)`,
    usage: null,
    estimatedCost: null,
  };
}

export function createScaffoldAdapter(spec: ScaffoldSpec): IntegrationAdapter {
  return {
    name: spec.name,
    type: spec.type,
    description: spec.description,
    capabilities: spec.capabilities,
    requiredEnvVars: spec.requiredEnvVars,
    timeoutMs: 10_000,
    maxRetries: 0,

    validateConfiguration(): AdapterConfig {
      return {
        environment: "UNKNOWN",
        requiredEnvVars: [...spec.requiredEnvVars],
        presentEnvVars: spec.requiredEnvVars.filter((name) => Boolean(process.env[name])),
      };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const startedAt = Date.now();
      const config = this.validateConfiguration();
      return {
        adapterName: spec.name,
        // Even with env vars present, no real integration exists yet, so a
        // health check cannot honestly claim more than NOT_CONFIGURED.
        status: config.presentEnvVars.length >= spec.requiredEnvVars.length ? "CONFIGURED" : "NOT_CONFIGURED",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: null,
        capabilities: [...spec.capabilities],
        environment: config.environment,
      };
    },

    async execute(action: string, _payload: unknown, _context: ExecutionContext): Promise<ExecutionResult> {
      return notConfiguredResult(spec, action);
    },
  };
}

export function createScaffoldAdapters(): IntegrationAdapter[] {
  return SCAFFOLD_SPECS.map(createScaffoldAdapter);
}
