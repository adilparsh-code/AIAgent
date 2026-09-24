export type ExecutionOutcomeStatus = "SUCCEEDED" | "FAILED" | "TIMEOUT" | "RATE_LIMITED" | "AUTH_FAILED" | "UNAVAILABLE" | "BLOCKED";
export type ExperimentLifecycleAfterExecution = "ACTIVE" | "FAILED" | "STOPPED" | "PAUSED";

/** Execution completion is not experiment success; only ACTIVE means collect measurements. */
export function experimentStatusAfterExecution(status: ExecutionOutcomeStatus): ExperimentLifecycleAfterExecution {
  if (status === "SUCCEEDED") return "ACTIVE";
  if (status === "FAILED") return "FAILED";
  if (status === "TIMEOUT" || status === "RATE_LIMITED") return "PAUSED";
  return "STOPPED";
}
