export interface ResearchHistoryRunInput {
  id: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  status: string;
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  contradictionCount: number;
  validationConclusion?: string | null;
}

export interface ResearchHistorySourceInput {
  researchRunId: string;
  provider: string;
  status: string;
  evidenceCount: number;
}

export interface ResearchHistoryEvidenceInput {
  researchRunId: string;
  hash: string;
  source: string;
  title: string;
  url: string;
  collectedAt: Date | string;
}

export interface ResearchTrendPoint {
  runId: string;
  date: string;
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  contradictionCount: number;
  status: string;
}

export interface ResearchProviderSummary {
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  evidenceItems: number;
}

export interface RecurringEvidence {
  hash: string;
  appearances: number;
  runs: string[];
  title: string;
  source: string;
  url: string;
}

export interface ResearchHistorySummary {
  runCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  latestRunId: string | null;
  latestVsPrevious: {
    confidenceDelta: number | null;
    evidenceDelta: number | null;
    sourceDiversityDelta: number | null;
    contradictionDelta: number | null;
  };
  trend: ResearchTrendPoint[];
  providers: ResearchProviderSummary[];
  recurringEvidence: RecurringEvidence[];
  repeatedEvidenceCount: number;
  uniqueEvidenceCount: number;
}

/**
 * Pure cross-run research intelligence. It never invents market evidence:
 * every trend point and recurring item comes from persisted research rows.
 */
export function summarizeResearchHistory(
  runs: ResearchHistoryRunInput[],
  sources: ResearchHistorySourceInput[],
  evidence: ResearchHistoryEvidenceInput[],
): ResearchHistorySummary {
  const orderedRuns = [...runs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const trend = orderedRuns.map((run) => ({
    runId: run.id,
    date: new Date(run.completedAt ?? run.startedAt).toISOString(),
    confidence: Number(run.confidence),
    evidenceCount: run.evidenceCount,
    sourceDiversity: run.sourceDiversity,
    contradictionCount: run.contradictionCount,
    status: run.status,
  }));

  const providers = new Map<string, ResearchProviderSummary>();
  for (const row of sources) {
    const current = providers.get(row.provider) ?? {
      provider: row.provider,
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      evidenceItems: 0,
    };
    current.attempts += 1;
    if (row.status === "SUCCEEDED" || row.status === "COMPLETED" || row.status === "HEALTHY") {
      current.successes += 1;
    } else {
      current.failures += 1;
    }
    current.evidenceItems += row.evidenceCount;
    current.successRate = current.attempts ? current.successes / current.attempts : 0;
    providers.set(row.provider, current);
  }

  const evidenceByHash = new Map<string, ResearchHistoryEvidenceInput[]>();
  for (const item of evidence) {
    const list = evidenceByHash.get(item.hash) ?? [];
    list.push(item);
    evidenceByHash.set(item.hash, list);
  }

  const recurringEvidence = [...evidenceByHash.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.researchRunId)).size > 1)
    .map(([hash, items]) => {
      const uniqueRuns = [...new Set(items.map((item) => item.researchRunId))];
      const first = items[0]!;
      return {
        hash,
        appearances: uniqueRuns.length,
        runs: uniqueRuns,
        title: first.title,
        source: first.source,
        url: first.url,
      };
    })
    .sort((a, b) => b.appearances - a.appearances || a.hash.localeCompare(b.hash));

  const latest = orderedRuns.at(-1);
  const previous = orderedRuns.at(-2);
  const delta = (a: number | undefined, b: number | undefined) =>
    a === undefined || b === undefined ? null : Number((a - b).toFixed(4));

  return {
    runCount: orderedRuns.length,
    completedCount: orderedRuns.filter((run) => run.status === "COMPLETED").length,
    partialCount: orderedRuns.filter((run) => run.status === "PARTIAL").length,
    failedCount: orderedRuns.filter((run) => run.status === "FAILED").length,
    latestRunId: latest?.id ?? null,
    latestVsPrevious: {
      confidenceDelta: latest && previous ? delta(Number(latest.confidence), Number(previous.confidence)) : null,
      evidenceDelta: latest && previous ? delta(latest.evidenceCount, previous.evidenceCount) : null,
      sourceDiversityDelta: latest && previous ? delta(latest.sourceDiversity, previous.sourceDiversity) : null,
      contradictionDelta: latest && previous ? delta(latest.contradictionCount, previous.contradictionCount) : null,
    },
    trend,
    providers: [...providers.values()].sort(
      (a, b) => b.successRate - a.successRate || b.evidenceItems - a.evidenceItems || a.provider.localeCompare(b.provider),
    ),
    recurringEvidence: recurringEvidence.slice(0, 20),
    repeatedEvidenceCount: recurringEvidence.length,
    uniqueEvidenceCount: evidenceByHash.size,
  };
}
