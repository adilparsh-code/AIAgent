/**
 * Next-action planner (pure, deterministic).
 *
 * Maps a deterministic decision state plus its structured gap sets to EXACTLY
 * ONE recommended next action. The action is derived entirely from persisted
 * application state — no LLM, no external API, no invented market data.
 *
 * This module is deliberately separate from the decision engine so the action
 * vocabulary is testable on its own and every action cites its persisted basis
 * (nothing to display, nothing to act on, is never hidden).
 */

export type NextAction =
  | "Run research for this opportunity."
  | "Collect additional demand evidence."
  | "Collect additional pain-point evidence."
  | "Collect additional commercial-intent evidence."
  | "Collect additional trend evidence."
  | "Collect additional competition evidence."
  | "Collect evidence from additional distinct sources."
  | "Refresh stale research."
  | "Review contradictory evidence."
  | "Create a validation experiment."
  | "Collect additional REAL_DATA."
  | "Improve experiment measurement."
  | "Create or accept the AI Income Lab handoff."
  | "Execute the approved task."
  | "Human review required before execution."
  | "Resolve the blocking status before further work.";

export interface NextActionGaps {
  /** Machine-readable evidence areas that still lack persisted support. */
  evidenceAreas: ReadonlySet<string>;
  /** True when any persisted signal contains unresolved contradictions. */
  hasContradictions: boolean;
  /** True when stored research exists but is older than the freshness threshold. */
  staleResearch: boolean;
  /** True when a research run is currently RUNNING. */
  researchRunning: boolean;
  /** Experiment summary: count of REAL_DATA / estimated metric periods. */
  realMetricPeriods: number;
  estimatedMetricPeriods: number;
  experimentCount: number;
  /** Persisted handoff status (null when no handoff row exists). */
  handoffStatus: string | null;
}

export interface NextActionRecommendation {
  /** Exactly one action, grounded in the stated basis. */
  action: NextAction;
  /** The persisted state this action resolves (shown in the UI). */
  basis: string;
}

/** Map an evidence-gap area to its concrete collection action. */
export function actionForEvidenceArea(area: string): NextAction {
  switch (area) {
    case "DEMAND":
      return "Collect additional demand evidence.";
    case "PAIN_POINT":
      return "Collect additional pain-point evidence.";
    case "COMMERCIAL_INTENT":
      return "Collect additional commercial-intent evidence.";
    case "TREND":
      return "Collect additional trend evidence.";
    case "COMPETITION":
      return "Collect additional competition evidence.";
    case "SOURCE_DIVERSITY":
      return "Collect evidence from additional distinct sources.";
    case "CONTRADICTION_RESOLUTION":
      return "Review contradictory evidence.";
    case "EXPERIMENT_DATA":
      return "Collect additional REAL_DATA.";
    default:
      // Unknown area: the generic evidence action. Never throws on bad data.
      return "Collect additional demand evidence.";
  }
}

/** Area ordering used to pick the single action when several gaps exist. */
const AREA_PRIORITY = [
  "CONTRADICTION_RESOLUTION",
  "DEMAND",
  "COMMERCIAL_INTENT",
  "PAIN_POINT",
  "TREND",
  "COMPETITION",
  "SOURCE_DIVERSITY",
  "EXPERIMENT_DATA",
] as const;

/**
 * Pick exactly one next action for a decision state. Never throws on missing
 * fields — every input is optional and null-safe so partial/malformed rows
 * degrade to the safest possible recommendation.
 */
export function recommendNextAction(
  decision: string,
  gaps: Partial<NextActionGaps>,
): NextActionRecommendation {
  const evidenceAreas = gaps.evidenceAreas ?? new Set<string>();
  const hasContradictions = Boolean(gaps.hasContradictions);
  const staleResearch = Boolean(gaps.staleResearch);
  const researchRunning = Boolean(gaps.researchRunning);
  const realPeriods = gaps.realMetricPeriods ?? 0;
  const estimatedPeriods = gaps.estimatedMetricPeriods ?? 0;
  const experimentCount = gaps.experimentCount ?? 0;
  const handoffStatus = gaps.handoffStatus ?? null;

  const firstGap = AREA_PRIORITY.find((area) => evidenceAreas.has(area));

  switch (decision) {
    case "BLOCKED":
      return {
        action: "Resolve the blocking status before further work.",
        basis: "Opportunity status is REJECTED or halalStatus is NOT_ALLOWED",
      };
    case "HUMAN_REVIEW":
      return {
        action: "Human review required before execution.",
        basis: hasContradictions
          ? "Persisted signals conflict and require human resolution"
          : "Approval/security requirement must be satisfied by a person",
      };
    case "REVIEW_CONFLICT":
      return {
        action: "Review contradictory evidence.",
        basis: "Validation contains unresolved contradictory signals",
      };
    case "RESEARCH_MORE":
      if (researchRunning) {
        return {
          action: "Run research for this opportunity.",
          basis: "A research run is currently RUNNING; wait for it to finish",
        };
      }
      if (firstGap) {
        return {
          action: actionForEvidenceArea(firstGap),
          basis: `Persisted validation reports a gap in ${firstGap.replace(/_/g, " ").toLowerCase()}`,
        };
      }
      if (staleResearch) {
        return {
          action: "Refresh stale research.",
          basis: "Stored research is older than the configured freshness threshold",
        };
      }
      return {
        action: "Run research for this opportunity.",
        basis: "No completed research run exists",
      };
    case "VALIDATE":
      if (staleResearch) {
        return {
          action: "Refresh stale research.",
          basis: "Stored research is older than the configured freshness threshold; a fresh run must precede validation",
        };
      }
      if (firstGap) {
        return {
          action: actionForEvidenceArea(firstGap),
          basis: `Persisted validation reports a gap in ${firstGap.replace(/_/g, " ").toLowerCase()}`,
        };
      }
      return {
        action: "Run research for this opportunity.",
        basis: "Research runs exist but no validation summary is persisted for the latest run",
      };
    case "RUN_EXPERIMENT":
      if (experimentCount > 0) {
        return {
          action: "Collect additional REAL_DATA.",
          basis: "Experiment exists but has no REAL_DATA measurement periods",
        };
      }
      return {
        action: "Create a validation experiment.",
        basis: "Research and validation are sufficient; no experiment exists yet",
      };
    case "IMPROVE_EXPERIMENT":
      if (firstGap === "EXPERIMENT_DATA" || estimatedPeriods > 0) {
        return {
          action: "Improve experiment measurement.",
          basis:
            estimatedPeriods > 0
              ? `Experiment data is ${estimatedPeriods} estimated period(s); estimated data is never treated as REAL_DATA`
              : "Experiment has too few REAL_DATA periods to affect the decision",
        };
      }
      return {
        action: "Collect additional REAL_DATA.",
        basis: `Only ${realPeriods} REAL_DATA period(s) recorded`,
      };
    case "HANDOFF_READY":
      return {
        action: "Create or accept the AI Income Lab handoff.",
        basis: "Evidence, validation, and experiment data satisfy handoff requirements",
      };
    case "EXECUTION_READY":
      return {
        action: "Execute the approved task.",
        basis: `Handoff status is ${handoffStatus ?? "ACCEPTED"}; approved execution conditions are satisfied`,
      };
    default:
      // Unknown decision: the safest possible action, still grounded.
      return {
        action: "Human review required before execution.",
        basis: `Unknown decision state "${String(decision)}" requires human confirmation`,
      };
  }
}
