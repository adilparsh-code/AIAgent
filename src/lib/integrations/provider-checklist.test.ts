import { describe, expect, it } from "vitest";
import { getProviderChecklist, getProviderChecklistEntry } from "./provider-checklist";

describe("provider activation checklist", () => {
  it("covers every current built-in provider without inventing future providers", () => {
    const providers = getProviderChecklist().map((entry) => entry.provider);
    expect(providers).toEqual(expect.arrayContaining(["ai-provider", "sambanova", "brave-search", "reddit", "google-trends", "pinterest", "youtube"]));
    expect(providers).not.toContain("tavily");
    expect(providers).toHaveLength(new Set(providers).size);
  });

  it("describes credentials, optional variables, and health requirements", () => {
    const brave = getProviderChecklistEntry("brave-search");
    expect(brave).toMatchObject({
      requiredEnvironmentVariables: ["BRAVE_SEARCH_API_KEY"],
      optionalEnvironmentVariables: ["RESEARCH_PROVIDER_ENV"],
      healthCheckRequired: true,
      liveTestRequired: true,
      credentialRequired: true,
    });
    expect(getProviderChecklistEntry("reddit")).toMatchObject({ credentialRequired: false, requiredEnvironmentVariables: [] });
  });

  it("marks unimplemented scaffolds as non-live and disabled", () => {
    const scaffold = getProviderChecklistEntry("pinterest");
    expect(scaffold).toMatchObject({ isScaffold: true, healthCheckRequired: false, liveTestRequired: false });
  });
});
