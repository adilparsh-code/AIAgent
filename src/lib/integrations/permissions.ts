import type { IntegrationCapability } from "./contract";
import { capabilityRequiresApproval } from "./contract";

/**
 * Phase 8 — capability-based permission model.
 *
 * Every external action goes through this gate:
 * - the action must be allowlisted for the task type,
 * - the adapter must declare the required capability,
 * - approval-requiring capabilities (PUBLISH / SEND_MESSAGE /
 *   CREATE_CAMPAIGN / SPEND_MONEY) always require an explicit approval
 *   decision from the task owner. There is no bypass in Phase 8.
 *
 * External content never reaches this module as an instruction source: only
 * trusted internal task definitions (AgentTask rows) request actions.
 */

/**
 * Allowlisted actions per AgentTask type. The runtime cannot execute an
 * action outside this table — this is the task-level boundary that keeps
 * external content from steering execution.
 */
export const TASK_TYPE_ACTIONS: Record<string, ReadonlyArray<{ action: string; adapter: string; capability: IntegrationCapability }>> = {
  RESEARCH: [
    { action: "SEARCH_WEB", adapter: "brave-search", capability: "SEARCH" },
    { action: "SEARCH_POSTS", adapter: "reddit", capability: "SEARCH" },
    { action: "SEARCH_TRENDS", adapter: "google-trends", capability: "SEARCH" },
  ],
  SEO_RESEARCH: [{ action: "SEARCH_TRENDS", adapter: "google-trends", capability: "SEARCH" }],
  AFFILIATE_RESEARCH: [{ action: "SEARCH_WEB", adapter: "brave-search", capability: "SEARCH" }],
  CONTENT_DRAFT: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
  PRODUCT_OUTLINE: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
  LANDING_PAGE_DRAFT: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
  PIN_CONTENT_DRAFT: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
  EXPERIMENT_ANALYSIS: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
  REPORT_GENERATION: [{ action: "GENERATE_TEXT", adapter: "sambanova", capability: "CREATE_DRAFT" }],
};

export interface ActionRequest {
  taskType: string;
  action: string;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  adapter: string | null;
  capability: IntegrationCapability | null;
  requiresApproval: boolean;
}

/**
 * Decide whether a task may run an action through an adapter. Approval is
 * always required for approval-class capabilities; read/search capabilities
 * are auto-executable because they are safe and tenant-scoped.
 */
export function decidePermission(request: ActionRequest, adapterCapabilities: readonly IntegrationCapability[]): PermissionDecision {
  const entries = TASK_TYPE_ACTIONS[request.taskType];
  if (!entries) {
    return {
      allowed: false,
      reason: `task type "${request.taskType}" is not mapped to any allowlisted action`,
      adapter: null,
      capability: null,
      requiresApproval: false,
    };
  }
  const entry = entries.find((candidate) => candidate.action === request.action);
  if (!entry) {
    return {
      allowed: false,
      reason: `action "${request.action}" is not allowlisted for task type "${request.taskType}"`,
      adapter: null,
      capability: null,
      requiresApproval: false,
    };
  }
  if (!adapterCapabilities.includes(entry.capability)) {
    return {
      allowed: false,
      reason: `adapter "${entry.adapter}" does not declare capability "${entry.capability}"`,
      adapter: entry.adapter,
      capability: entry.capability,
      requiresApproval: capabilityRequiresApproval(entry.capability),
    };
  }
  return {
    allowed: true,
    reason: capabilityRequiresApproval(entry.capability)
      ? `capability "${entry.capability}" requires explicit approval`
      : `capability "${entry.capability}" is safe to execute (tenant-scoped)`,
    adapter: entry.adapter,
    capability: entry.capability,
    requiresApproval: capabilityRequiresApproval(entry.capability),
  };
}
