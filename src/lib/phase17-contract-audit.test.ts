import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Phase 17 contract and security audit", () => {
  it("keeps activation and live-cycle APIs authenticated and owner-scoped", () => {
    for (const path of [
      "src/app/api/integrations/[id]/activate/route.ts",
      "src/app/api/integrations/[id]/live-test/route.ts",
      "src/app/api/research/live-cycle/route.ts",
    ]) {
      const text = source(path);
      expect(text).toContain("requireUser");
      expect(text).toContain("ownerId");
      expect(text).toContain("apiError");
    }
  });

  it("does not introduce automatic dangerous capabilities or client secret exposure", () => {
    const files = [
      "src/lib/integrations/live-activation-controller.ts",
      "src/lib/integrations/live-provider-normalization.ts",
      "src/lib/integrations/real-data-integrity.ts",
      "src/app/api/integrations/[id]/live-test/route.ts",
    ];
    const text = files.map(source).join("\n");
    expect(text).not.toContain("NEXT_PUBLIC_");
    expect(text).not.toMatch(/process\.env\.[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)/);
    expect(text).toContain("LIVE_WRITE_TEST_REQUIRES_APPROVAL");
    expect(text).toContain("sanitize");
  });

  it("retains stable request-derived research identity", () => {
    const text = source("src/lib/integrations/live-research-cycle.ts");
    expect(text).toContain("buildLiveResearchRunId");
    expect(text).toContain("createHash");
    expect(text).toContain("ResearchRun primary key");
  });
});
