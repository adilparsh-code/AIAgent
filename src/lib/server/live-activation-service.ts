import "server-only";

import { getPrisma } from "@/lib/db";
import { logger } from "@/lib/server/logger";
import { getProviderActivations } from "@/lib/integrations/activation-service";
import {
  activateProvider as activateWithController,
  runLiveProviderTest as runTestWithController,
  type ControllerExecutionResult,
  type ControllerHealthResult,
  type LiveActivationDependencies,
  type LiveActivationResult,
} from "@/lib/integrations/live-activation-controller";
import { runHealthCheck } from "@/lib/integrations/service";
import { runTestExecution } from "@/lib/server/test-execution-service";

async function activationFor(provider: string) {
  const activations = await getProviderActivations();
  return activations.find((activation) => activation.provider === provider) ?? {
    provider,
    status: "UNAVAILABLE" as const,
    capabilities: [],
    requiredVariables: [],
    optionalVariables: [],
    configured: false,
    healthCheckRequired: true,
    liveTestRequired: true,
    approvalRequired: false,
    safeReason: "Provider is not represented in the activation registry.",
    lastHealthCheckAt: null,
  };
}

export async function activateProvider(input: { provider: string; ownerId: string }): Promise<LiveActivationResult> {
  const deps: LiveActivationDependencies = {
    getActivation: activationFor,
    checkHealth: async (provider): Promise<ControllerHealthResult> => {
      const summary = await runHealthCheck(provider);
      if (!summary) throw new Error("Provider activation is unavailable.");
      if (!summary.lastCheckedAt) throw new Error("Provider health result could not be persisted.");
      return {
        status: summary.status,
        checkedAt: summary.lastCheckedAt,
        latencyMs: summary.latencyMs,
        error: summary.lastError,
        dataClass: summary.healthDataClass,
      };
    },
    executeLiveTest: async ({ provider, ownerId, requestId, action }): Promise<ControllerExecutionResult> => {
      const result = await runTestExecution({
        integrationName: provider,
        ownerId,
        requestId,
        action: action.action,
        mode: "LIVE",
      });
      let output: unknown = null;
      if (result.executionId) {
        const execution = await getPrisma().agentExecution.findUnique({
          where: { id: result.executionId },
          select: { result: true },
        });
        const stored = execution?.result as { output?: unknown } | null;
        output = stored?.output ?? null;
      }
      return {
        status: result.status,
        executionId: result.executionId,
        action: result.action,
        capability: action.capability,
        durationMs: result.durationMs,
        error: result.error,
        dataClass: result.dataClass,
        output,
      };
    },
    emit: (event) => logger.operationalEvent(event),
  };
  return activateWithController(deps, input);
}

export async function runLiveProviderTest(input: {
  provider: string;
  ownerId: string;
  requestId: string;
  action?: string;
}): Promise<LiveActivationResult> {
  const deps: LiveActivationDependencies = {
    getActivation: activationFor,
    checkHealth: async (provider) => {
      const summary = await runHealthCheck(provider);
      if (!summary?.lastCheckedAt) throw new Error("Provider health result could not be persisted.");
      return { status: summary.status, checkedAt: summary.lastCheckedAt, latencyMs: summary.latencyMs, error: summary.lastError, dataClass: summary.healthDataClass };
    },
    executeLiveTest: async ({ provider, ownerId, requestId, action }): Promise<ControllerExecutionResult> => {
      const result = await runTestExecution({
        integrationName: provider,
        ownerId,
        requestId,
        action: action.action,
        mode: "LIVE",
      });
      let output: unknown = null;
      if (result.executionId) {
        const execution = await getPrisma().agentExecution.findUnique({
          where: { id: result.executionId },
          select: { result: true },
        });
        output = (execution?.result as { output?: unknown } | null)?.output ?? null;
      }
      return {
        status: result.status,
        executionId: result.executionId,
        action: result.action,
        capability: action.capability,
        durationMs: result.durationMs,
        error: result.error,
        dataClass: result.dataClass,
        output,
      };
    },
    emit: (event) => logger.operationalEvent(event),
  };
  return runTestWithController(deps, input);
}

