import { getResearchProviders } from "./research-providers";
import type { Evidence, ResearchFinding, ResearchQuery, ResearchRun, ResearchProviderName } from "./research-types";

function runId() {
  return `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeQueries(title: string): ResearchQuery[] {
  return [
    { query: `${title} demand market`, source: "brave", purpose: "demand" },
    { query: `${title} people want problems`, source: "reddit", purpose: "pain-point" },
    { query: `${title} trends`, source: "google-trends", purpose: "trend" },
    { query: `${title} price buy alternatives`, source: "brave", purpose: "commercial-intent" },
  ];
}

function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.hash)) return false;
    seen.add(item.hash);
    return true;
  });
}

function buildFindings(evidence: Evidence[]): ResearchFinding[] {
  if (!evidence.length) return [];
  const grouped = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = item.supports[0] ?? "market";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].map(([purpose, items], index) => ({
    id: `finding-${index + 1}-${purpose}`,
    claim: `${purpose} evidence collected from ${items.length} independent result${items.length === 1 ? "" : "s"}`,
    summary: items.slice(0, 3).map((item) => item.title).join("; "),
    confidence: Number(Math.min(1, items.reduce((sum, item) => sum + item.qualityScore, 0) / Math.max(1, items.length)).toFixed(2)),
    evidenceIds: items.map((item) => item.id),
    contradictions: items.filter((item) => item.contradicts.length).flatMap((item) => item.contradicts),
  }));
}

export async function runResearch(opportunityId: string, title: string): Promise<ResearchRun> {
  const startedAt = new Date().toISOString();
  const queries = makeQueries(title);
  const providers = getResearchProviders();
  const evidence: Evidence[] = [];
  const errors: string[] = [];
  const attempted: ResearchProviderName[] = [];
  const succeeded: ResearchProviderName[] = [];

  for (const provider of providers) {
    attempted.push(provider.name);
    const providerQueries = queries.filter((query) => query.source === provider.name);
    try {
      let providerEvidence: Evidence[] = [];
      for (const query of providerQueries) {
        providerEvidence.push(...await provider.search(query));
      }
      evidence.push(...providerEvidence);
      if (providerEvidence.length) succeeded.push(provider.name);
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown provider error"}`);
    }
  }

  const cleanEvidence = dedupeEvidence(evidence);
  const findings = buildFindings(cleanEvidence);
  const confidence = cleanEvidence.length
    ? Number((cleanEvidence.reduce((sum, item) => sum + item.qualityScore, 0) / cleanEvidence.length).toFixed(2))
    : 0;

  return {
    id: runId(), opportunityId, status: errors.length && !cleanEvidence.length ? "FAILED" : errors.length ? "PARTIAL" : "COMPLETED",
    startedAt, completedAt: new Date().toISOString(), queries,
    evidence: cleanEvidence, findings, confidence,
    providersAttempted: attempted, providersSucceeded: succeeded, errors,
  };
}
