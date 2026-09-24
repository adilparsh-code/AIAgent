import "server-only";
import type { IntegrationAdapter } from "./contract";
import { createSambaNovaAdapter } from "./adapters/sambanova";
import {
  createBraveSearchAdapter,
  createRedditAdapter,
  createSerpApiTrendsAdapter,
} from "./adapters/research";
import { createScaffoldAdapters } from "./adapters/scaffolds";

/**
 * Phase 8 — central integration registry.
 *
 * Responsibilities (deliberately narrow — this is NOT an unrestricted
 * execution mechanism):
 * - register/resolve adapters with duplicate-name prevention
 * - list integrations with their declared capabilities + config presence
 * - run real health checks and return their results
 *
 * All execution remains tenant-scoped: every execute() call takes an
 * ExecutionContext with the ownerId resolved server-side from the session.
 */
export class IntegrationRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`integration "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  resolve(name: string): IntegrationAdapter | null {
    return this.adapters.get(name) ?? null;
  }

  require(name: string): IntegrationAdapter {
    const adapter = this.resolve(name);
    if (!adapter) {
      throw new Error(`integration "${name}" is not registered`);
    }
    return adapter;
  }

  list(): IntegrationAdapter[] {
    return [...this.adapters.values()];
  }

  /** Register the full built-in set (idempotent per registry instance). */
  static withBuiltIns(): IntegrationRegistry {
    const registry = new IntegrationRegistry();
    registry.register(createSambaNovaAdapter());
    registry.register(createBraveSearchAdapter());
    registry.register(createRedditAdapter());
    registry.register(createSerpApiTrendsAdapter());
    for (const scaffold of createScaffoldAdapters()) {
      registry.register(scaffold);
    }
    return registry;
  }
}

/** Per-process shared registry (adapters are stateless; no user data here). */
let sharedRegistry: IntegrationRegistry | null = null;

export function getIntegrationRegistry(): IntegrationRegistry {
  if (!sharedRegistry) {
    sharedRegistry = IntegrationRegistry.withBuiltIns();
  }
  return sharedRegistry;
}
