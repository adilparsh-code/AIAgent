/**
 * Research cycle abstraction (pure, deterministic).
 *
 * Describes one research lifecycle as a fixed stage ladder and positions a
 * persisted research run within it:
 *
 *   DISCOVER → COLLECT → NORMALIZE → VALIDATE → CORRELATE
 *     → ASSESS → UPDATE INTELLIGENCE → REASSESS READINESS
 *
 * The position is computed ONLY from persisted application data — no external
 * API, no fabricated research. When live providers are added later they plug
 * into the COLLECT stage (see STAGE_OWNERS); the decision architecture above
 * this module does not change.
 */

/** Fixed research-cycle stages, in execution order. */
export const RESEARCH_CYCLE_STAGES = [
  "DISCOVER",
  "COLLECT",
  "NORMALIZE",
  "VALIDATE",
  "CORRELATE",
  "ASSESS",
  "UPDATE_INTELLIGENCE",
  "REASSESS_READINESS",
] as const;

export type ResearchCycleStage = (typeof RESEARCH_CYCLE_STAGES)[number];

/**
 * Which existing component owns each stage today. Future live providers
 * implement collection and plug in at COLLECT without changing anything
 * downstream: normalization, validation, correlation, assessment, the
 * transactional intelligence update, and readiness/decision recomputation
 * all consume the same persisted shapes.
 */
export const STAGE_OWNERS: Record<ResearchCycleStage, string> = {
  DISCOVER: "discovery-engine (hypothesis generation; no market facts invented)",
  COLLECT: "research-providers (Brave/Reddit/Trends today; future providers plug in here)",
  NORMALIZE: "evidence-normalization (sanitize, dedupe by hash, classify dataClass)",
  VALIDATE: "validation layer (per-signal statuses from evidence)",
  CORRELATE: "research-history intelligence (cross-source/cross-run recurring evidence)",
  ASSESS: "validation conclusion (evidence-driven, never inferred from run success)",
  UPDATE_INTELLIGENCE: "transactional run save + opportunity research metadata",
  REASSESS_READINESS: "readiness + decision engines (recomputed per request, never cached)",
};

export interface ResearchCycleRunInput {
  id: string;
  status: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  evidenceCount: number;
  /** Distinct evidence sources of the latest run's validation, when persisted. */
  sourceDiversity: number | null;
  /** Evidence-driven conclusion persisted with the latest run, when any. */
  validationConclusion: string | null;
}

export interface ResearchCyclePosition {
  latestRunId: string | null;
  /** Stages completed by the latest run, in ladder order. */
  completedStages: ResearchCycleStage[];
  /** First stage not yet completed; null only when the ladder is exhausted. */
  currentStage: ResearchCycleStage | null;
  /** The persisted fact that places the cycle at currentStage. */
  currentStageReason: string;
  /** True when every stage up to UPDATE_INTELLIGENCE is complete. */
  cycleComplete: boolean;
}

function isTerminalRunStatus(status: string): boolean {
  return status === "COMPLETED" || status === "PARTIAL";
}

/**
 * Position a research run in the cycle. Null-safe: empty/malformed inputs
 * degrade to the DISCOVER stage instead of throwing.
 */
export function positionResearchCycle(
  run: Partial<ResearchCycleRunInput> | null,
  options: { /** Opportunity-level metadata: set when the last run save updated it. */ intelligenceUpdatedAt?: Date | string | null } = {},
): ResearchCyclePosition {
  if (!run || typeof run.id !== "string" || run.id.length === 0) {
    return {
      latestRunId: null,
      completedStages: [],
      currentStage: "DISCOVER",
      currentStageReason: "No research run exists for this opportunity",
      cycleComplete: false,
    };
  }

  const status = typeof run.status === "string" ? run.status : "UNKNOWN";
  const evidenceCount = Number.isFinite(Number(run.evidenceCount)) ? Number(run.evidenceCount) : 0;
  const completed: ResearchCycleStage[] = ["DISCOVER"];
  let currentStage: ResearchCycleStage = "COLLECT";
  let reason = `Latest research run is ${status}; collection has not produced usable evidence yet`;

  if (status === "RUNNING") {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage: "COLLECT",
      currentStageReason: "A research run is currently RUNNING (collecting evidence)",
      cycleComplete: false,
    };
  }
  if (status === "FAILED") {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage: "COLLECT",
      currentStageReason: `Latest research run FAILED; discovery succeeded but collection must be re-run`,
      cycleComplete: false,
    };
  }
  if (!isTerminalRunStatus(status)) {
    // Unknown status: stop at COLLECT rather than assuming success.
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage: "COLLECT",
      currentStageReason: `Latest research run has unknown status "${status}"; collection cannot be assumed`,
      cycleComplete: false,
    };
  }

  if (evidenceCount > 0) {
    // Evidence rows are persisted already normalized, sanitized, and
    // deduplicated — COLLECT and NORMALIZE complete together in this
    // architecture.
    completed.push("COLLECT", "NORMALIZE");
    currentStage = "VALIDATE";
    reason = "Evidence was collected and normalized (persisted, deduplicated by content hash)";
  } else {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage: "COLLECT",
      currentStageReason: "The latest run completed but collected no evidence; collection must yield evidence",
      cycleComplete: false,
    };
  }

  const hasValidation = Boolean(run.validationConclusion) || Number(run.sourceDiversity) > 0 || (run.sourceDiversity ?? -1) >= 0;
  if (hasValidation) {
    completed.push("VALIDATE");
    currentStage = "CORRELATE";
    reason = "A validation summary is persisted for the latest run";
  } else {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage,
      currentStageReason: "No validation summary is persisted for the latest run",
      cycleComplete: false,
    };
  }

  const sourceDiversity = Number.isFinite(Number(run.sourceDiversity)) ? Number(run.sourceDiversity) : 0;
  if (sourceDiversity >= 2) {
    // Correlation proxy grounded in persisted data: evidence from ≥ 2 distinct
    // sources can be correlated; recurring cross-run evidence is reported by
    // the research-history intelligence.
    completed.push("CORRELATE");
    currentStage = "ASSESS";
    reason = `Evidence spans ${sourceDiversity} distinct source(s); correlation is possible`;
  } else {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage,
      currentStageReason: `Evidence comes from ${sourceDiversity} distinct source(s); at least 2 are required for correlation`,
      cycleComplete: false,
    };
  }

  if (typeof run.validationConclusion === "string" && run.validationConclusion.length > 0) {
    completed.push("ASSESS");
    currentStage = "UPDATE_INTELLIGENCE";
    reason = `An evidence-driven conclusion (${run.validationConclusion}) is persisted`;
  } else {
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage,
      currentStageReason: "No evidence-driven conclusion is persisted for the latest run",
      cycleComplete: false,
    };
  }

  const intelligenceUpdatedAt = options.intelligenceUpdatedAt ?? null;
  if (intelligenceUpdatedAt) {
    // The run save is transactional: run + evidence + validation + opportunity
    // research metadata commit together or not at all, so a completed run with
    // updated metadata means intelligence was applied.
    completed.push("UPDATE_INTELLIGENCE");
    currentStage = "REASSESS_READINESS";
    reason = "Research intelligence was applied to the opportunity (transactional run save)";
    return {
      latestRunId: run.id,
      completedStages: completed,
      currentStage,
      currentStageReason:
        "All persisted stages are complete; readiness and decision are recomputed on each request (REASSESS_READINESS is continuous, never cached)",
      cycleComplete: true,
    };
  }
  return {
    latestRunId: run.id,
    completedStages: completed,
    currentStage,
    currentStageReason: "Opportunity research metadata was not updated by the last run save",
    cycleComplete: false,
  };
}
