import type {
  Evidence,
  ResearchConclusion,
  ResearchFinding,
  ResearchPurpose,
  ScoreFactorGuidance,
  ScoreIntegration,
  ValidationSignal,
} from "./research-types";

// ---------------------------------------------------------------------------
// Every threshold below is an explicit, documented evidence rule — never a guess.
// ---------------------------------------------------------------------------

const SUPPORTED_MIN_EVIDENCE = 3;
const SUPPORTED_MIN_SOURCES = 2;
const MIXED_MIN_EVIDENCE = 1;
const SUPPORTED_MIN_QUALITY = 0.5;
const CONCLUSION_MIN_CONFIDENCE = 0.5;

const SIGNAL_LABELS: Record<string, string> = {
  demand: "Demand",
  "pain-point": "Pain Point",
  "commercial-intent": "Commercial Intent",
  trend: "Trend",
  competition: "Competition",
};

interface PurposeStats {
  count: number;
  sources: Set<string>;
  avgQuality: number;
  contradicted: boolean;
  evidenceIds: string[];
}

function purposeStats(evidence: Evidence[], purpose: ResearchPurpose): PurposeStats {
  const items = evidence.filter((item) => item.supports.includes(purpose));
  const avgQuality = items.length
    ? items.reduce((sum, item) => sum + item.qualityScore, 0) / items.length
    : 0;
  return {
    count: items.length,
    sources: new Set(items.map((item) => item.source)),
    avgQuality,
    contradicted: items.some((item) => item.contradicts.length > 0),
    evidenceIds: items.map((item) => item.id),
  };
}

function statusFor(stats: PurposeStats): ValidationSignal["status"] {
  if (stats.count === 0) return "INSUFFICIENT";
  const enoughEvidence = stats.count >= SUPPORTED_MIN_EVIDENCE;
  const enoughSources = stats.sources.size >= SUPPORTED_MIN_SOURCES;
  const enoughQuality = stats.avgQuality >= SUPPORTED_MIN_QUALITY;

  if (enoughEvidence && enoughSources && enoughQuality) {
    return stats.contradicted ? "MIXED" : "SUPPORTED";
  }
  if (stats.count >= MIXED_MIN_EVIDENCE) return "MIXED";
  return "INSUFFICIENT";
}

function basisFor(label: string, stats: PurposeStats): string {
  const sourceWord = stats.sources.size === 1 ? "1 provider" : `${stats.sources.size} providers`;
  return `${stats.count} evidence item(s) from ${sourceWord}, avg quality ${stats.avgQuality.toFixed(2)}` +
    (stats.contradicted ? ", contradicted by at least one source" : "");
}

/** Evidence-driven validation signals. No invented market data. */
export function buildValidationSignals(evidence: Evidence[]): ValidationSignal[] {
  const purposes: ResearchPurpose[] = ["demand", "pain-point", "commercial-intent", "trend", "competition"];
  return purposes.map((purpose) => {
    const stats = purposeStats(evidence, purpose);
    return {
      key: purpose,
      label: SIGNAL_LABELS[purpose] ?? purpose,
      status: statusFor(stats),
      evidenceIds: stats.evidenceIds,
      basis: basisFor(SIGNAL_LABELS[purpose] ?? purpose, stats),
    };
  });
}

export function countContradictions(evidence: Evidence[], findings: ResearchFinding[]): number {
  const evidenceContradictions = evidence.reduce((sum, item) => sum + item.contradicts.length, 0);
  const findingContradictions = findings.reduce((sum, finding) => sum + finding.contradictions.length, 0);
  return evidenceContradictions + findingContradictions;
}

export function buildConclusion(
  evidence: Evidence[],
  signals: ValidationSignal[],
  confidence: number,
  contradictionCount: number,
  providersAttempted: number,
  providersSucceeded: number,
): { conclusion: ResearchConclusion; basis: string } {
  if (!evidence.length) {
    const reason =
      providersAttempted === 0
        ? "No provider could be executed."
        : `${providersAttempted} provider(s) executed without returning usable evidence.`;
    return { conclusion: "INSUFFICIENT_EVIDENCE", basis: `No evidence collected. ${reason}` };
  }

  // Signals that would be SUPPORTED but are contradicted by other sources.
  const contradictedSignals = signals.filter(
    (signal) => signal.status === "MIXED" &&
      evidence.some((item) => item.contradicts.length > 0 && item.supports.includes(signal.key as ResearchPurpose)),
  );

  const signalCounts = {
    supported: signals.filter((s) => s.status === "SUPPORTED").length,
    mixed: signals.filter((s) => s.status === "MIXED").length,
    insufficient: signals.filter((s) => s.status === "INSUFFICIENT").length,
  };

  if (signalCounts.supported === 0 && contradictedSignals.length > 0) {
    return {
      conclusion: "CONTRADICTED",
      basis: `${contradictedSignals.length} signal(s) are contradicted by other evidence (${contradictedSignals.map((s) => s.label).join(", ")}).`,
    };
  }

  if (confidence < CONCLUSION_MIN_CONFIDENCE && signalCounts.supported === 0) {
    return {
      conclusion: "REQUIRES_HUMAN_REVIEW",
      basis: `Confidence ${confidence.toFixed(2)} is below ${CONCLUSION_MIN_CONFIDENCE} and no signal is fully supported.`,
    };
  }

  if (signalCounts.supported >= 2) {
    // Any recorded contradiction next to supported signals demands human judgment:
    // automated rules cannot decide which side of a disagreement is correct.
    return {
      conclusion: contradictionCount > 0 ? "REQUIRES_HUMAN_REVIEW" : "VALIDATED",
      basis:
        `${signalCounts.supported} signal(s) fully supported (each by >= ${SUPPORTED_MIN_EVIDENCE} items ` +
        `from >= ${SUPPORTED_MIN_SOURCES} sources), confidence ${confidence.toFixed(2)}` +
        (contradictionCount > 0 ? `, ${contradictionCount} contradiction(s) recorded` : ", no contradictions recorded"),
    };
  }

  if (contradictedSignals.length > 0) {
    // Contradicted evidence exists without two clean SUPPORTED signals: human review,
    // not a positive conclusion, is the honest outcome.
    return {
      conclusion: "REQUIRES_HUMAN_REVIEW",
      basis: `Evidence contains contradiction(s) without fully supported signals (${contradictedSignals.map((s) => s.label).join(", ")}).`,
    };
  }

  if (signalCounts.mixed > 0 && confidence >= CONCLUSION_MIN_CONFIDENCE) {
    return {
      conclusion: "PROMISING",
      basis: `${signalCounts.mixed} signal(s) partially supported, ${signalCounts.insufficient} insufficient; confidence ${confidence.toFixed(2)}.`,
    };
  }

  return {
    conclusion: "INSUFFICIENT_EVIDENCE",
    basis: `0 fully supported and ${signalCounts.mixed} partially supported signals; confidence ${confidence.toFixed(2)}.`,
  };
}

/**
 * Research-informed guidance for the EXISTING weighted scoring engine.
 * The engine itself is untouched; this only suggests evidence-based adjustments
 * and always marks factors that cannot be safely derived as requiring review.
 */
export function buildScoreIntegration(
  signals: ValidationSignal[],
  conclusion: ResearchConclusion,
  evidence: Evidence[],
): ScoreIntegration {
  const signalByKey = new Map(signals.map((signal) => [signal.key, signal]));
  const demand = signalByKey.get("demand");
  const commercial = signalByKey.get("commercial-intent");
  const competition = signalByKey.get("competition");

  const factors: ScoreFactorGuidance[] = [
    {
      key: "demand",
      status: statusToFactorStatus(demand, conclusion),
      basis: demand ? demand.basis : "No demand evidence collected.",
    },
    {
      key: "commercialIntent",
      status: statusToFactorStatus(commercial, conclusion),
      basis: commercial ? commercial.basis : "No commercial-intent evidence collected.",
    },
    {
      key: "competitionOpportunity",
      status: statusToFactorStatus(competition, conclusion),
      basis: competition ? competition.basis : "No competition evidence collected.",
    },
    {
      key: "startupCost",
      status: "unchanged",
      basis: "Startup cost comes from user input; research does not measure it.",
    },
    {
      key: "automationPotential",
      status: "unchanged",
      basis: "Automation potential is not measured by current providers.",
    },
    {
      key: "differentiation",
      status: "unchanged",
      basis: "Differentiation requires product-specific analysis not derivable from this evidence.",
    },
    {
      key: "monetizationStrength",
      status: statusToFactorStatus(commercial, conclusion),
      basis: commercial ? `Mirrors commercial-intent signal. ${commercial.basis}` : "No commercial-intent evidence collected.",
    },
    {
      key: "halalCompliance",
      status: "human-review-required",
      basis: "Compliance is never derived from research; human review is always required before launch.",
    },
  ];

  const researchSupported = factors.filter((f) => f.status === "research-supported").length;
  const suggestedOverallScore =
    researchSupported >= 2
      ? Number(
          (
            (demand?.status === "SUPPORTED" ? 75 : demand?.status === "MIXED" ? 55 : 40) * 0.2 +
            (commercial?.status === "SUPPORTED" ? 75 : commercial?.status === "MIXED" ? 55 : 40) * 0.2 +
            (competition?.status === "SUPPORTED" ? 70 : competition?.status === "MIXED" ? 50 : 40) * 0.15 +
            40 * 0.1 +
            40 * 0.1 +
            40 * 0.1 +
            (commercial?.status === "SUPPORTED" ? 60 : 40) * 0.1 +
            50 * 0.05
          ).toFixed(1),
        )
      : null;

  return {
    suggestedOverallScore,
    factors,
    ...(researchSupported >= 2
      ? {}
      : { note: "Too few research-supported factors to suggest a score; human review required." }),
  };
}

function statusToFactorStatus(
  signal: ValidationSignal | undefined,
  conclusion: ResearchConclusion,
): ScoreFactorGuidance["status"] {
  if (!signal || signal.status === "INSUFFICIENT") return "insufficient-evidence";
  if (signal.status === "SUPPORTED") return "research-supported";
  if (conclusion === "CONTRADICTED") return "research-unsupported";
  return "human-review-required";
}

/**
 * Derive the persistable Validation row from a completed research run.
 * Pure derivation from the run's own signals/evidence — nothing is invented.
 */
export function buildPersistedValidation(run: {
  id: string;
  evidence: Evidence[];
  validationSignals: ValidationSignal[];
  confidence: number;
  conclusion: ResearchConclusion;
  conclusionBasis: string;
}): {
  signals: ValidationSignal[];
  evidenceCoverage: number;
  sourceDiversity: number;
  contradictionCount: number;
  confidence: number;
  conclusion: ResearchConclusion;
  conclusionBasis: string;
} {
  const contradictionCount = countContradictions(run.evidence, []);
  return {
    signals: run.validationSignals,
    evidenceCoverage: run.evidence.length,
    sourceDiversity: new Set(run.evidence.map((item) => item.source)).size,
    contradictionCount,
    confidence: run.confidence,
    conclusion: run.conclusion,
    conclusionBasis: run.conclusionBasis,
  };
}

export const VALIDATION_RULES = {
  SUPPORTED_MIN_EVIDENCE,
  SUPPORTED_MIN_SOURCES,
  MIXED_MIN_EVIDENCE,
  SUPPORTED_MIN_QUALITY,
  CONCLUSION_MIN_CONFIDENCE,
} as const;
