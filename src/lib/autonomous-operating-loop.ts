/**
 * Phase 13 — Autonomous Operating Loop (pure, deterministic).
 *
 * This module plans the next operational action from existing persisted
 * portfolio, decision, lifecycle and experiment read-models. It does not
 * execute, publish, send, spend, call external APIs, or persist anything.
 * `Opportunity.status` and the existing decision/readiness engines remain
 * authoritative; this is an orchestration projection, not a second state
 * machine.
 */
import type { OpportunityDecision } from "@/lib/opportunity-decision";
import type {
  OpportunityPortfolioIntelligence,
  PortfolioQueue,
  PortfolioRecommendation,
} from "@/lib/opportunity-portfolio";

export const AUTONOMOUS_OPERATING_LOOP_STAGES = [
  "PORTFOLIO_ASSESSMENT",
  "OPPORTUNITY_SELECTION",
  "RESEARCH",
  "VALIDATION",
  "EXPERIMENT",
  "LEARNING",
  "HANDOFF",
  "EXECUTION",
  "MEASUREMENT",
  "REASSESSMENT",
  "PORTFOLIO_REASSESSMENT",
  "OBSERVE",
  "ASSESS",
  "SELECT",
  "RECOVER",
  "COMPLETE",
] as const;
export type AutonomousOperatingLoopStage = (typeof AUTONOMOUS_OPERATING_LOOP_STAGES)[number];

export interface OperatingLoopExecutionGates {
  authenticatedOwner: boolean;
  opportunityOwned: boolean;
  decisionState: string;
  readinessState: string;
  handoffAccepted: boolean;
  taskApprovalSatisfied: boolean;
  executionPermissions: boolean;
  requiredCapabilityAvailable: boolean;
  realDataRequired: boolean;
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
}

export interface OperatingLoopCandidate {
  opportunityId: string;
  queue: PortfolioQueue;
  decision: OpportunityDecision;
  recommendation: PortfolioRecommendation;
}

export interface AutonomousOperatingLoop {
  cycleId: string;
  generatedAt: string;
  portfolioDecision: OpportunityPortfolioIntelligence["portfolioDecision"];
  selectedOpportunityId: string | null;
  selectedQueue: PortfolioQueue | null;
  currentOpportunityDecision: OpportunityDecision | null;
  currentLifecycle: string | null;
  nextAction: string;
  actionReason: string;
  blocked: boolean;
  blockers: string[];
  requiredApproval: boolean;
  executionEligible: boolean;
  dataClass: "REAL_DATA" | "AI_ESTIMATE" | "SAMPLE_DATA";
  cycleStage: AutonomousOperatingLoopStage;
  explanation: string[];
}

const QUEUE_STAGE: Record<PortfolioQueue, AutonomousOperatingLoopStage> = {
  RESEARCH_QUEUE: "RESEARCH",
  VALIDATION_QUEUE: "VALIDATION",
  EXPERIMENT_QUEUE: "EXPERIMENT",
  LEARNING_QUEUE: "LEARNING",
  HANDOFF_QUEUE: "HANDOFF",
  EXECUTION_QUEUE: "EXECUTION",
  HUMAN_REVIEW_QUEUE: "OPPORTUNITY_SELECTION",
  BLOCKED_QUEUE: "OPPORTUNITY_SELECTION",
  MONITOR_QUEUE: "MEASUREMENT",
};

function actionStage(candidate: OperatingLoopCandidate): AutonomousOperatingLoopStage {
  // Persisted lifecycle and learning state win over queue labels when an
  // experiment has already produced a decision. This is a read-model stage,
  // never a new persisted status machine.
  if (candidate.decision.lifecycleState === "MEASURING") return "MEASUREMENT";
  if (candidate.decision.lifecycleState === "LEARNED") return "REASSESSMENT";
  if (
    candidate.decision.learningSignal === true &&
    candidate.decision.decision !== "IMPROVE_EXPERIMENT" &&
    ["HANDOFF_READY", "EXECUTION_READY", "HUMAN_REVIEW"].includes(candidate.decision.decision)
  ) {
    return "REASSESSMENT";
  }
  return QUEUE_STAGE[candidate.queue];
}

function nextActionFor(candidate: OperatingLoopCandidate, stage: AutonomousOperatingLoopStage): string {
  if (stage === "REASSESSMENT") return "Reassess opportunity.";
  if (stage === "PORTFOLIO_REASSESSMENT") return "Reassess opportunity and portfolio priority.";
  return candidate.decision.recommendedAction.action;
}

function stableLoopCycleId(portfolio: OpportunityPortfolioIntelligence, opportunityId: string, stage: AutonomousOperatingLoopStage): string {
  const basis = `${portfolio.portfolioDecision}|${opportunityId}|${stage}|${portfolio.totalOpportunities}`;
  let hash = 0;
  for (const character of basis) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `cycle-${Math.abs(hash).toString(36)}`;
}

function emptyLoop(
  portfolio: OpportunityPortfolioIntelligence,
  now: Date,
  explanation: string[],
): AutonomousOperatingLoop {
  return {
    cycleId: stableLoopCycleId(portfolio, "empty", "PORTFOLIO_ASSESSMENT"),
    generatedAt: now.toISOString(),
    portfolioDecision: portfolio.portfolioDecision,
    selectedOpportunityId: null,
    selectedQueue: null,
    currentOpportunityDecision: null,
    currentLifecycle: null,
    nextAction: "Assess the portfolio before selecting an operational action.",
    actionReason: "No eligible operational candidate is available in the bounded portfolio view.",
    blocked: false,
    blockers: [],
    requiredApproval: false,
    executionEligible: false,
    dataClass: portfolio.dataClass,
    cycleStage: "PORTFOLIO_ASSESSMENT",
    explanation,
  };
}

/**
 * Build one cycle. Candidate order is the already-deterministic portfolio
 * recommendation order; ties and input ordering are never used to select a
 * different candidate. The first candidate with a defined next action wins.
 */
export function createAutonomousOperatingLoop(input: {
  portfolio: OpportunityPortfolioIntelligence;
  decisions: Map<string, OpportunityDecision>;
  gates: Map<string, OperatingLoopExecutionGates>;
  now?: Date;
}): AutonomousOperatingLoop {
  const now = input.now ?? new Date();
  const { portfolio } = input;
  if (portfolio.totalOpportunities === 0) {
    return emptyLoop(portfolio, now, [
      "Portfolio assessment completed from persisted owner-scoped data.",
      "No opportunity is available for an operational next action.",
    ]);
  }

  const recommendationById = new Map(portfolio.recommendations.map((item) => [item.opportunityId, item]));
  const candidates: OperatingLoopCandidate[] = portfolio.recommendations
    .map((recommendation) => {
      const decision = input.decisions.get(recommendation.opportunityId);
      if (!decision) return null;
      return {
        opportunityId: recommendation.opportunityId,
        queue: Object.entries(portfolio.queues).find(([, ids]) => ids.includes(recommendation.opportunityId))?.[0] as PortfolioQueue,
        decision,
        recommendation,
      };
    })
    .filter((item): item is OperatingLoopCandidate => item !== null);

  // Recommendations are capped by the portfolio. If a legacy/partial response
  // has recommendations but no matching decision, fail closed rather than
  // inventing a candidate.
  const candidate = candidates.find((item) => {
    const stage = actionStage(item);
    return stage !== "PORTFOLIO_ASSESSMENT" && item.decision.recommendedAction.action.length > 0;
  });

  if (!candidate) {
    return emptyLoop(portfolio, now, [
      "Portfolio assessment completed, but no candidate had a defined operational next action.",
      recommendationById.size > 0
        ? "The selected recommendation had no matching persisted decision."
        : "No opportunity required immediate operational attention.",
    ]);
  }

  const stage = actionStage(candidate);
  const gate = input.gates.get(candidate.opportunityId) ?? {
    authenticatedOwner: false,
    opportunityOwned: false,
    decisionState: candidate.decision.decision,
    readinessState: candidate.decision.readinessState,
    handoffAccepted: false,
    taskApprovalSatisfied: false,
    executionPermissions: false,
    requiredCapabilityAvailable: false,
    realDataRequired: true,
    dataClass: candidate.decision.dataClass,
  };
  const blockers: string[] = [];
  if (!gate.authenticatedOwner) blockers.push("Authenticated owner context is required.");
  if (!gate.opportunityOwned) blockers.push("Opportunity ownership could not be verified.");
  if (stage === "EXECUTION") {
    if (gate.decisionState !== "EXECUTION_READY") {
      blockers.push("The current decision is not EXECUTION_READY.");
    }
    if (gate.readinessState !== "READY_FOR_EXECUTION") {
      blockers.push("Readiness is not READY_FOR_EXECUTION.");
    }
    if (!gate.handoffAccepted) {
      blockers.push("The handoff is not ACCEPTED or COMPLETED.");
    }
    if (!gate.taskApprovalSatisfied) blockers.push("Task approval is not satisfied.");
    if (!gate.executionPermissions) blockers.push("Execution permissions are not satisfied.");
    if (!gate.requiredCapabilityAvailable) blockers.push("The required execution capability is not available.");
    if (gate.realDataRequired && gate.dataClass !== "REAL_DATA") {
      blockers.push("REAL_DATA is required for this execution eligibility report.");
    }
  }
  if (candidate.decision.decision === "HUMAN_REVIEW" || candidate.decision.decision === "REVIEW_CONFLICT") {
    blockers.push("Human review or conflict resolution is required before further action.");
  }
  if (candidate.decision.decision === "BLOCKED") {
    blockers.push("The opportunity is blocked by its persisted status or policy state.");
  }

  const requiredApproval =
    candidate.decision.decision === "HUMAN_REVIEW" ||
    (stage === "EXECUTION" && !gate.taskApprovalSatisfied);
  const executionEligible = stage === "EXECUTION" && blockers.length === 0 && !requiredApproval;
  const nextAction = nextActionFor(candidate, stage);
  const explanation = [
    `Portfolio decision is ${portfolio.portfolioDecision}; selected for next operational action.`,
    `Selected ${candidate.opportunityId} from ${candidate.queue} using the deterministic operational recommendation.`,
    candidate.recommendation.reason,
    candidate.decision.recommendedAction.basis,
    "This layer determines what should happen next; it does not execute external actions.",
  ];

  return {
    cycleId: stableLoopCycleId(portfolio, candidate.opportunityId, stage),
    generatedAt: now.toISOString(),
    portfolioDecision: portfolio.portfolioDecision,
    selectedOpportunityId: candidate.opportunityId,
    selectedQueue: candidate.queue,
    currentOpportunityDecision: candidate.decision,
    currentLifecycle: candidate.decision.lifecycleState,
    nextAction,
    actionReason: candidate.decision.recommendedAction.basis,
    blocked: candidate.decision.decision === "BLOCKED" || candidate.decision.decision === "HUMAN_REVIEW" || candidate.decision.decision === "REVIEW_CONFLICT",
    blockers,
    requiredApproval,
    executionEligible,
    dataClass: gate.dataClass,
    cycleStage: stage,
    explanation,
  };
}
