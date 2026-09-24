/**
 * Phase 15 — deterministic provider/capability activation matrix.
 *
 * The existing integration permission model is capability-based. This matrix
 * documents that mapping without creating a second permission or approval
 * system. Dangerous capabilities remain approval-gated even if a future
 * adapter declares them.
 */

import { APPROVAL_REQUIRED_CAPABILITIES, capabilityRequiresApproval, type IntegrationCapability } from "./contract";
import { getProviderChecklist } from "./provider-checklist";

export interface ProviderCapabilityRule {
  provider: string;
  capability: IntegrationCapability;
  permission: IntegrationCapability;
  approvalRequired: boolean;
  liveVerificationRequired: boolean;
  automaticExecutionAllowed: boolean;
}

export const DANGEROUS_PROVIDER_CAPABILITIES: readonly IntegrationCapability[] = APPROVAL_REQUIRED_CAPABILITIES;

export function getProviderCapabilityMatrix(): readonly ProviderCapabilityRule[] {
  return getProviderChecklist()
    .flatMap((entry) => entry.capabilities.map((capability) => ({
      provider: entry.provider,
      capability,
      permission: capability,
      approvalRequired: capabilityRequiresApproval(capability),
      liveVerificationRequired: true,
      automaticExecutionAllowed: !capabilityRequiresApproval(capability),
    })))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.capability.localeCompare(b.capability));
}

export function getDangerousCapabilityPolicy(capability: IntegrationCapability): ProviderCapabilityRule {
  return {
    provider: "__policy__",
    capability,
    permission: capability,
    approvalRequired: true,
    liveVerificationRequired: true,
    automaticExecutionAllowed: false,
  };
}
