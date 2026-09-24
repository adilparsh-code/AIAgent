/**
 * Phase 9 — test-execution catalog (pure, provider-independent).
 *
 * A "test execution" is a real, safe, strictly-bounded call against ONE
 * configured provider, chosen by the operator in the Integrations control
 * center. This module is the pure half: it resolves which allowlisted actions
 * a provider exposes, what deterministic objective each action runs with, and
 * the hard limits every test execution must obey. The server half
 * (server/test-execution-service.ts) performs the authenticated, owner-scoped
 * execution through the Phase 9A orchestrator.
 *
 * Safety rules encoded here (asserted by tests):
 * - Only actions in the Phase 8 allowlist (TASK_TYPE_ACTIONS) are offered.
 * - Only zero-financial-impact capabilities may be tested: READ_DATA, SEARCH,
 *   CREATE_DRAFT. Approval-class capabilities (PUBLISH / SEND_MESSAGE /
 *   CREATE_CAMPAIGN / SPEND_MONEY) and irreversible actions (UPLOAD) are
 *   NEVER test-executable — the human approval gate still governs them.
 * - Scaffold adapters (not yet implemented) are never test-executable.
 * - Test objectives are fixed, deterministic, and tiny: a test never carries
 *   user-supplied instructions into a provider call.
 */

import { TASK_TYPE_ACTIONS } from "./permissions";
import type { IntegrationCapability } from "./contract";
import { isAgentTaskType, type AgentTaskType } from "../agent-task";

/** Capabilities a test execution may exercise. Everything else is excluded. */
export const TEST_EXECUTABLE_CAPABILITIES: readonly IntegrationCapability[] = [
  "READ_DATA",
  "SEARCH",
  "CREATE_DRAFT",
];

/** Hard limits for every test execution — tiny, bounded, non-financial. */
export const TEST_EXECUTION_LIMITS = {
  timeLimitSeconds: 60,
  maxOutputChars: 2_000,
  maxRetries: 1,
  maxActions: 1,
  budgetLimit: 0,
} as const;

export interface TestActionDescriptor {
  integration: string;
  action: string;
  capability: IntegrationCapability;
  /** The allowlisted AgentTask type that owns this action. */
  taskType: AgentTaskType;
  /** Fixed, deterministic objective — never user-supplied. */
  objective: string;
  /** Fixed instructions, also never user-supplied. */
  instructions: string;
  /** Human label for the UI. */
  label: string;
}

/**
 * Deterministic, low-cost test objectives. These are constants on purpose: a
 * test execution must be reproducible and must never be a vehicle for
 * user-supplied instructions reaching a provider.
 */
const TEST_OBJECTIVES: Record<string, { objective: string; instructions: string; label: string }> = {
  GENERATE_TEXT: {
    objective: "Reply with exactly this text and nothing else: AIAGENT PHASE 9 TEST OK",
    instructions: "Deterministic connectivity test. Return the requested text verbatim. No tools, no URLs, no extra commentary.",
    label: "Generate a fixed test string (text)",
  },
  SEARCH_WEB: {
    objective: "Connectivity test search for: ai income lab phase 9 integration test",
    instructions: "Deterministic connectivity test. Return the provider's raw search results for the objective query.",
    label: "Run a fixed web search query",
  },
  SEARCH_POSTS: {
    objective: "Connectivity test search for: ai income lab phase 9 integration test",
    instructions: "Deterministic connectivity test. Return the provider's raw search results for the objective query.",
    label: "Run a fixed community search query",
  },
  SEARCH_TRENDS: {
    objective: "Connectivity test trends query for: ai income lab",
    instructions: "Deterministic connectivity test. Return the provider's raw trend data for the objective query.",
    label: "Run a fixed trends query",
  },
};

/** True when a capability may be exercised by a test execution. */
export function isTestExecutableCapability(capability: IntegrationCapability): boolean {
  return TEST_EXECUTABLE_CAPABILITIES.includes(capability);
}

/**
 * Resolve the safe, allowlisted test actions for one integration. Returns an
 * empty array for scaffolds and for providers with no safe allowlisted action.
 */
export function resolveTestActions(integrationName: string): TestActionDescriptor[] {
  const actions: TestActionDescriptor[] = [];
  const seen = new Set<string>();
  for (const [taskType, entries] of Object.entries(TASK_TYPE_ACTIONS)) {
    if (!isAgentTaskType(taskType)) continue;
    for (const entry of entries) {
      if (entry.adapter !== integrationName) continue;
      if (!isTestExecutableCapability(entry.capability)) continue;
      if (seen.has(entry.action)) continue;
      const spec = TEST_OBJECTIVES[entry.action];
      if (!spec) continue; // only actions with a fixed deterministic test
      seen.add(entry.action);
      actions.push({
        integration: integrationName,
        action: entry.action,
        capability: entry.capability,
        taskType: taskType as AgentTaskType,
        objective: spec.objective,
        instructions: spec.instructions,
        label: spec.label,
      });
    }
  }
  return actions;
}

/** Find a specific test action by name (undefined when not allowlisted/safe). */
export function resolveTestAction(
  integrationName: string,
  action?: string,
): TestActionDescriptor | null {
  const actions = resolveTestActions(integrationName);
  if (action === undefined || action === null || action === "") {
    return actions[0] ?? null;
  }
  return actions.find((candidate) => candidate.action === action) ?? null;
}

/**
 * Validate a client-supplied request id used for duplicate suppression. It
 * becomes part of the AgentTask id, so it is length-capped and restricted to
 * characters that are safe in a database identifier.
 */
export function sanitizeRequestId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}
