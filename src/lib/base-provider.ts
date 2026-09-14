import type { Evidence, ResearchQuery, ResearchProviderName } from "./research-types";

export interface ResearchProvider {
  name: ResearchProviderName;
  search(query: ResearchQuery): Promise<Evidence[]>;
}

export function safeProviderResult(result: Evidence[] | null | undefined): Evidence[] {
  return Array.isArray(result) ? result : [];
}
