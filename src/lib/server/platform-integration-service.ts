import "server-only";

import { getSystemHealth, getOperationalStatus } from "@/lib/server/system-health-service";
import { getGrowthPortfolioState } from "@/lib/server/growth-portfolio-service";
import { calculatePlatformIntegrationSnapshot, type PlatformIntegrationSnapshot } from "@/lib/platform-integration";

/**
 * Owner-scoped Phase 24 integration snapshot. Pure composition of the
 * existing health, operations, and Phase 23 growth services — no external
 * call, no new authority, no fabricated state.
 */
export async function getPlatformIntegrationSnapshot(
  ownerId: string,
  now = new Date(),
): Promise<PlatformIntegrationSnapshot> {
  const growth = await getGrowthPortfolioState(ownerId, now);
  const [systemHealth, operations] = await Promise.all([
    getSystemHealth(ownerId, now),
    getOperationalStatus(ownerId, now),
  ]);
  return calculatePlatformIntegrationSnapshot({ systemHealth, operations, growth, now });
}
