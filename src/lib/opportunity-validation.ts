import type { Evidence, ProviderRunStatus, ResearchRun, ValidationSignal } from "./research-types";
import { buildConclusion, buildValidationSignals, countContradictions } from "./validation";
import type { OpportunityEvidenceBundle } from "./discovery-types";

function emptySignal(key: string, label: string): ValidationSignal {
  return {
    key,
    label,
    status: "INSUFFICIENT",
    evidenceIds: [],
    basis: "No evidence collected. Missing data is not positive evidence.",
  };
}

function signalByKey(signals: ValidationSignal[], key: string, label: string): ValidationSignal {
  return signals.find((signal) => signal.key === key) ?? emptySignal(key, label);
}

/**
 * Monetization is never inferred from missing data. It only mirrors commercial-intent
 * evidence already collected by the research orchestrator.
 */
export function buildMonetizationSignal(signals: ValidationSignal[]): ValidationSignal {
  const commercial = signalByKey(signals, "commercial-intent", "Commercial Intent");
  if (commercial.status === "INSUFFICIENT") {
    return emptySignal("monetization", "Monetization");
  }
  return {
    key: "monetization",
    label: "Monetization",
    status: commercial.status,
    evidenceIds: commercial.evidenceIds,
    basis: `Derived only from commercial-intent evidence. ${commercial.basis}`,
  };
}

function averageQuality(evidence: Evidence[]): number {
  if (!evidence.length) return 0;
  return Number(
    (evidence.reduce((sum, item) => sum + item.qualityScore, 0) / evidence.length).toFixed(2),
  );
}

export function collectContradictions(evidence: Evidence[]): string[] {
  const values = evidence.flatMap((item) => item.contradicts).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(values));
}

/**
 * Evidence-based opportunity validation. Wraps existing research signals and
 * never treats missing provider data as support.
 */
export function buildOpportunityEvidenceBundle(run: ResearchRun): OpportunityEvidenceBundle {
  const signals = run.validationSignals.length ? run.validationSignals : buildValidationSignals(run.evidence);
  const demand = signalByKey(signals, "demand", "Demand");
  const painPoint = signalByKey(signals, "pain-point", "Pain Point");
  const trend = signalByKey(signals, "trend", "Trend");
  const commercialIntent = signalByKey(signals, "commercial-intent", "Commercial Intent");
  const competition = signalByKey(signals, "competition", "Competition");
  const monetization = buildMonetizationSignal(signals);
  const contradictionCount = countContradictions(run.evidence, run.findings);
  const contradictions = collectContradictions(run.evidence);
  const coverage = run.evidence.length;
  const diversity = new Set(run.evidence.map((item) => item.source)).size;
  const { conclusion, basis } = run.conclusion
    ? { conclusion: run.conclusion, basis: run.conclusionBasis }
    : buildConclusion(
        run.evidence,
        signals,
        run.confidence,
        contradictionCount,
        run.providersAttempted.length,
        run.providersSucceeded.length,
      );

  return {
    demand,
    painPoint,
    trend,
    commercialIntent,
    competition,
    monetization,
    evidenceQuality: averageQuality(run.evidence),
    evidenceCoverage: coverage,
    sourceDiversity: diversity,
    contradictionCount,
    providerStatuses: run.providerStatuses,
    contradictions,
    conclusion,
    conclusionBasis: basis,
    confidence: run.confidence,
  };
}

export function providerHealthSummary(statuses: ProviderRunStatus[]): string[] {
  return statuses.map((status) => {
    if (status.status === "SUCCEEDED") {
      return `${status.name}: succeeded (${status.evidenceCount} evidence)`;
    }
    if (status.status === "EMPTY") {
      return `${status.name}: empty (ran, no usable evidence)`;
    }
    if (status.status === "CONFIG_ERROR") {
      return `${status.name}: unavailable/not configured — no data invented`;
    }
    return `${status.name}: ${status.status.toLowerCase()}${status.error ? ` (${status.error})` : ""}`;
  });
}
