import "server-only";
import type { IntegrationAdapter, IntegrationStatus } from "./contract";
import { getPrisma, isDbUnavailableError } from "../db";
import { logger } from "../server/logger";
import { sanitizeErrorMessage } from "./contract";
import { getIntegrationRegistry } from "./registry";

/**
 * Phase 8 — integration status service. Bridges the stateless adapters with
 * persistence (IntegrationHealth / IntegrationExecution) and produces
 * client-safe summaries: env var NAMES and presence only — never values.
 */

export interface IntegrationSummary {
  name: string;
  type: string;
  description: string;
  status: IntegrationStatus;
  capabilities: string[];
  environment: string;
  requiredEnvVars: string[];
  presentEnvVars: string[];
  /** Env var names that must still be provided (safe to show in UI). */
  missingEnvVars: string[];
  lastCheckedAt: string | null;
  lastError: string | null;
  isScaffold: boolean;
}

/** Declare which adapters are scaffolds (no real API integration yet). */
const SCAFFOLD_NAMES = new Set([
  "pinterest",
  "youtube",
  "affiliate-network",
  "marketplace",
  "analytics-platform",
]);

function statusFromHealth(
  adapter: IntegrationAdapter,
  health: Awaited<ReturnType<IntegrationAdapter["healthCheck"]>> | null,
): IntegrationStatus {
  if (health) return health.status;
  // No check recorded yet: derive a static, honest pre-check status.
  const config = adapter.validateConfiguration();
  const missing = adapter.requiredEnvVars.filter((name) => !config.presentEnvVars.includes(name));
  if (adapter.requiredEnvVars.length === 0) return "CONFIGURED";
  return missing.length === 0 ? "CONFIGURED" : "NOT_CONFIGURED";
}

export async function listIntegrationSummaries(): Promise<IntegrationSummary[]> {
  const adapters = getIntegrationRegistry().list();
  const prisma = getPrisma();
  let healthRows: Array<{ adapterName: string; status: string; lastCheckedAt: Date | null; lastError: string | null }> = [];
  try {
    // The built-in registry is bounded; cap the persisted lookup as a defensive
    // boundary for future registry growth and owner-independent health pages.
    healthRows = await prisma.integrationHealth.findMany({ take: 32 });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    // Without a DB the UI can still show configuration status honestly.
  }
  const healthByName = new Map(healthRows.map((row) => [row.adapterName, row]));

  return adapters.map((adapter) => {
    const config = adapter.validateConfiguration();
    const health = healthByName.get(adapter.name) ?? null;
    const status = health ? (health.status as IntegrationStatus) : statusFromHealth(adapter, null);
    return {
      name: adapter.name,
      type: adapter.type,
      description: adapter.description,
      status,
      capabilities: [...adapter.capabilities],
      environment: config.environment,
      requiredEnvVars: [...adapter.requiredEnvVars],
      presentEnvVars: config.presentEnvVars,
      missingEnvVars: adapter.requiredEnvVars.filter((name) => !config.presentEnvVars.includes(name)),
      lastCheckedAt: health?.lastCheckedAt ? health.lastCheckedAt.toISOString() : null,
      lastError: health?.lastError ?? null,
      isScaffold: SCAFFOLD_NAMES.has(adapter.name),
    };
  });
}

export async function getIntegrationSummary(name: string): Promise<IntegrationSummary | null> {
  const all = await listIntegrationSummaries();
  return all.find((integration) => integration.name === name) ?? null;
}

/**
 * Run a REAL health check against the adapter and persist the outcome.
 * Never records a status the adapter did not actually produce.
 */
export async function runHealthCheck(name: string): Promise<IntegrationSummary | null> {
  const adapter = getIntegrationRegistry().resolve(name);
  if (!adapter) return null;

  const health = await adapter.healthCheck();
  try {
    const prisma = getPrisma();
    await prisma.integrationHealth.upsert({
      where: { adapterName: name },
      create: {
        adapterName: name,
        status: health.status,
        lastError: health.error,
        lastCheckedAt: new Date(health.checkedAt),
        capabilities: health.capabilities,
        environment: health.environment,
      },
      update: {
        status: health.status,
        lastError: health.error,
        lastCheckedAt: new Date(health.checkedAt),
        capabilities: health.capabilities,
        environment: health.environment,
      },
    });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
  }
  logger.integrationHealthChecked(name, health.status, health.error);
  return getIntegrationSummary(name);
}

/** Persist an adapter execution for audit (status, timing, sanitized error). */
export async function recordIntegrationExecution(input: {
  adapterName: string;
  action: string;
  ownerId: string;
  taskId: string | null;
  opportunityId: string | null;
  experimentId: string | null;
  result: Awaited<ReturnType<IntegrationAdapter["execute"]>>;
}): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.integrationExecution.create({
      data: {
        adapterName: input.adapterName,
        action: input.action,
        ownerId: input.ownerId,
        taskId: input.taskId,
        status: input.result.status,
        externalId: input.result.externalId,
        dataClass: input.result.dataClass,
        durationMs: input.result.durationMs,
        error: input.result.error ? sanitizeErrorMessage(input.result.error) : null,
        outputSummary:
          input.result.status === "SUCCEEDED" && input.result.output !== null && input.result.output !== undefined
            ? sanitizeErrorMessage(JSON.stringify(input.result.output).slice(0, 500))
            : null,
      },
    });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    // Audit persistence is best-effort; execution results still return.
  }
}


