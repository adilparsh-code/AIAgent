import type { BusinessModel, Category } from "./types";
import type { DiscoveryCandidateSeed, DiscoveryCategory } from "./discovery-types";
import { DISCOVERY_CATEGORIES } from "./discovery-types";

const MAX_CANDIDATES_DEFAULT = 5;
const MAX_CANDIDATES_CAP = 5;

export const CATEGORY_META: Record<
  DiscoveryCategory,
  { opportunityCategory: Category; businessModel: BusinessModel; label: string }
> = {
  "digital-products": {
    opportunityCategory: "DIGITAL_TOOLS",
    businessModel: "DIGITAL_PRODUCT",
    label: "digital product",
  },
  apps: {
    opportunityCategory: "DIGITAL_TOOLS",
    businessModel: "SAAS",
    label: "app",
  },
  affiliate: {
    opportunityCategory: "AFFILIATE",
    businessModel: "AFFILIATE",
    label: "affiliate opportunity",
  },
  education: {
    opportunityCategory: "EDUCATIONAL_RESOURCES",
    businessModel: "EDUCATIONAL",
    label: "education offer",
  },
  "pinterest-content": {
    opportunityCategory: "PRINTABLES",
    businessModel: "PRINTABLE",
    label: "Pinterest/content offer",
  },
  saas: {
    opportunityCategory: "SAAS",
    businessModel: "SAAS",
    label: "micro-SaaS",
  },
  "ai-tools": {
    opportunityCategory: "DIGITAL_TOOLS",
    businessModel: "SAAS",
    label: "AI tool",
  },
  "childrens-activities": {
    opportunityCategory: "CHILDRENS_BOOKS",
    businessModel: "DIGITAL_PRODUCT",
    label: "children's activity product",
  },
  other: {
    opportunityCategory: "DIGITAL_TOOLS",
    businessModel: "DIGITAL_PRODUCT",
    label: "income opportunity",
  },
};

export function isDiscoveryCategory(value: unknown): value is DiscoveryCategory {
  return typeof value === "string" && (DISCOVERY_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCandidateKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function seedFrom(
  title: string,
  category: DiscoveryCategory,
  problemHypothesis: string,
  targetAudience: string,
): DiscoveryCandidateSeed {
  const meta = CATEGORY_META[category];
  const trimmed = title.trim().slice(0, 240);
  return {
    title: trimmed,
    category,
    problemHypothesis: problemHypothesis.trim().slice(0, 500),
    targetAudience: targetAudience.trim().slice(0, 240),
    researchTitle: trimmed,
    normalizedKey: normalizeCandidateKey(trimmed),
    opportunityCategory: meta.opportunityCategory,
    businessModel: meta.businessModel,
  };
}

/**
 * Hypothesis angles for a topic. These are research queries, not market claims.
 * Nothing here is evidence; every seed must be researched before any conclusion.
 */
function hypothesisAngles(topic: string, category: DiscoveryCategory): DiscoveryCandidateSeed[] {
  const meta = CATEGORY_META[category];
  const t = topic.trim();
  return [
    seedFrom(
      `${t} ${meta.label}`,
      category,
      `Hypothesis: buyers looking for ${t} may lack a packaged ${meta.label}. Unconfirmed until researched.`,
      `People actively searching for ${t}`,
    ),
    seedFrom(
      `${t} problem-solver for underserved buyers`,
      category,
      `Hypothesis: existing ${t} options may leave a painful gap. Research must confirm whether that pain is evidenced.`,
      `People reporting problems with current ${t} options`,
    ),
    seedFrom(
      `${t} education or training offer`,
      category,
      `Hypothesis: learners may pay to get better at ${t}. Demand and commercial intent must be evidenced.`,
      `Beginners and practitioners who want to learn ${t}`,
    ),
    seedFrom(
      `${t} affiliate or content distribution`,
      category,
      `Hypothesis: there may be commercial-intent queries around ${t} that support an affiliate/content play. Unconfirmed until researched.`,
      `Researchers comparing ${t} products or services`,
    ),
    seedFrom(
      `${t} micro-tool or automation`,
      category,
      `Hypothesis: a focused tool around ${t} may be viable only if demand, pain, and monetization evidence exist.`,
      `Operators who repeat ${t} work manually`,
    ),
  ];
}

/**
 * Pull extra candidate titles from real evidence (provider search results).
 * Titles are hypotheses to research — snippets are not treated as validation.
 */
export function extraTitlesFromEvidence(
  titles: Array<{ title?: unknown } | string>,
  topic: string,
  limit = 2,
): string[] {
  const topicKey = normalizeCandidateKey(topic);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of titles) {
    const raw = typeof row === "string" ? row : typeof row?.title === "string" ? row.title : "";
    const title = raw.trim().slice(0, 240);
    if (title.length < 8) continue;
    const key = normalizeCandidateKey(title);
    if (!key || key === topicKey || seen.has(key)) continue;
    if (topicKey && !key.includes(topicKey.split(" ")[0] ?? topicKey) && !key.includes(topicKey)) {
      continue;
    }
    seen.add(key);
    out.push(title);
    if (out.length >= limit) break;
  }
  return out;
}

export function generateCandidates(
  topic: string,
  category: DiscoveryCategory,
  options?: { extraTitles?: string[]; maxCandidates?: number },
): DiscoveryCandidateSeed[] {
  const trimmed = topic.trim();
  if (trimmed.length < 3) return [];

  const max = Math.min(
    MAX_CANDIDATES_CAP,
    Math.max(1, options?.maxCandidates ?? MAX_CANDIDATES_DEFAULT),
  );

  const extras = (options?.extraTitles ?? [])
    .map((title) => title.trim())
    .filter((title) => title.length >= 8)
    .map((title) =>
      seedFrom(
        title,
        category,
        `Candidate harvested from provider search results for "${trimmed}". Not validated until researched.`,
        `Audience implied by search interest in ${trimmed}`,
      ),
    );

  const merged = [...extras, ...hypothesisAngles(trimmed, category)];
  const unique: DiscoveryCandidateSeed[] = [];
  const seen = new Set<string>();
  for (const seed of merged) {
    if (!seed.normalizedKey || seen.has(seed.normalizedKey)) continue;
    seen.add(seed.normalizedKey);
    unique.push(seed);
    if (unique.length >= max) break;
  }
  return unique;
}

export const DISCOVERY_CANDIDATE_LIMITS = {
  MAX_CANDIDATES_DEFAULT: 5,
  MAX_CANDIDATES_CAP: 5,
} as const;
