import { determineRecoveryPolicy, type RecoveryPolicyInput } from "@/lib/failure-classification";

export type { RecoveryAction } from "@/lib/failure-classification";

/** Compatibility entry point for callers that only need a recovery action. */
export function recommendRecoveryAction(input: RecoveryPolicyInput) {
  return determineRecoveryPolicy(input);
}
