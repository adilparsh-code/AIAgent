/**
 * The expected Prisma migration manifest.
 *
 * HIGH-6: readiness used to treat "one row exists in _prisma_migrations" as
 * proof that the schema is current, so a database missing most migrations was
 * still reported as ready. This manifest is the expected end state; the
 * readiness check compares the live `_prisma_migrations` table against it.
 *
 * Keep in sync with `prisma/migrations/`. `migration-readiness.test.ts`
 * asserts that the directory listing and this list are identical, so a new
 * migration that is not registered here fails CI.
 */
export const EXPECTED_MIGRATIONS: readonly string[] = [
  "20240919120000_init",
  "20260919000000_research_validation",
  "20260919010000_phase2_research_sources_validation_agent_runs",
  "20260922000000_phase4_discovery",
  "20260923000000_phase5_handoff_experiment",
  "20260923120000_phase6a_auth_multitenancy",
  "20260923130000_phase6b_metric_time_series",
  "20260923140000_phase6c_learning_reranking",
  "20260923150000_phase7_agent_tasks",
  "20260923160000_phase8_integration_framework",
  "20260923200000_phase9a_agent_executions",
  "20260924150000_phase17_live_activation_health_metadata",
  "20260925120000_high4_one_experiment_per_handoff",
  "20260926000000_high1_handoff_delivery",
  "20260926001000_medium11_denormalized_foreign_keys",
  "20260926002000_medium6_discovery_candidate_failed_status",
] as const;
