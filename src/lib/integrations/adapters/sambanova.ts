import {
  classifyHttpError,
  errorClassToStatus,
  sanitizeErrorMessage,
  type AdapterConfig,
  type ExecutionContext,
  type ExecutionResult,
  type HealthCheckResult,
  type IntegrationAdapter,
  type IntegrationCapability,
  type IntegrationEnvironment,
} from "../contract";

/**
 * Phase 8 — AI provider adapter (SambaNova, OpenAI-compatible chat
 * completions over plain fetch — no SDK lock-in, matching the project's
 * fetch-based research providers).
 *
 * Honesty rules:
 * - Without SAMBANOVA_API_KEY the adapter reports NOT_CONFIGURED and execute()
   returns UNAVAILABLE — it never fabricates output.
 * - Usage metadata is echoed only when the provider actually returns it;
 *   estimated cost is null unless the provider supplies real usage figures
 *   that a known price can be applied to. Unknown → null, never invented.
 */
const SAMBANOVA_BASE_URL = "https://api.sambanova.ai/v1/chat/completions";
const DEFAULT_MODEL = "Meta-Llama-3.1-8B-Instruct";

export const SAMBANOVA_ENV_VARS = ["SAMBANOVA_API_KEY"] as const;
export const SAMBANOVA_OPTIONAL_ENV_VARS = ["SAMBANOVA_BASE_URL", "SAMBANOVA_MODEL", "AI_PROVIDER_ENV"] as const;

const CAPABILITIES: readonly IntegrationCapability[] = ["READ_DATA", "CREATE_DRAFT"];

function resolveEnvironment(): IntegrationEnvironment {
  const raw = (process.env.AI_PROVIDER_ENV ?? "").trim().toUpperCase();
  return raw === "LIVE" || raw === "TEST" ? (raw as IntegrationEnvironment) : "UNKNOWN";
}

export function createSambaNovaAdapter(): IntegrationAdapter {
  return {
    name: "sambanova",
    type: "AI_PROVIDER",
    description: "LLM chat-completion provider (OpenAI-compatible) used by the agent runtime for draft/analysis tasks.",
    capabilities: CAPABILITIES,
    requiredEnvVars: SAMBANOVA_ENV_VARS,
    optionalEnvVars: SAMBANOVA_OPTIONAL_ENV_VARS,
    timeoutMs: 30_000,
    maxRetries: 2,

    validateConfiguration(): AdapterConfig {
      const required = SAMBANOVA_ENV_VARS.filter((name) => Boolean(process.env[name]));
      return {
        environment: resolveEnvironment(),
        requiredEnvVars: [...SAMBANOVA_ENV_VARS],
        presentEnvVars: [...required],
      };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const startedAt = Date.now();
      const config = this.validateConfiguration();
      const base = {
        adapterName: "sambanova" as const,
        capabilities: [...CAPABILITIES],
        environment: config.environment,
      };
      if (config.presentEnvVars.length < SAMBANOVA_ENV_VARS.length) {
        return {
          ...base,
          status: "NOT_CONFIGURED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: null,
        };
      }
      // Real authentication probe: a 1-token completion proves key validity.
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(SAMBANOVA_BASE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SAMBANOVA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.SAMBANOVA_MODEL ?? DEFAULT_MODEL,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        const errorClass = classifyHttpError(
          response.ok ? null : response.status,
          response.ok ? undefined : `sambanova health probe HTTP ${response.status}`,
        );
        const status = response.ok
          ? ("HEALTHY" as const)
          : errorClass === "RATE_LIMIT"
            ? ("DEGRADED" as const) // reachable + authenticated but throttled
            : errorClass === "AUTH"
              ? ("AUTH_FAILED" as const)
              : ("FAILED" as const);
        return {
          ...base,
          status,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: response.ok ? null : sanitizeErrorMessage(`sambanova health probe HTTP ${response.status}`),
        };
      } catch (error) {
        return {
          ...base,
          status: "FAILED",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: sanitizeErrorMessage(error instanceof Error ? error.message : "health probe failed"),
        };
      }
    },

    async execute(action: string, payload: unknown, context: ExecutionContext): Promise<ExecutionResult> {
      const startedAt = new Date().toISOString();
      const finish = (
        partial: Omit<ExecutionResult, "provider" | "action" | "startedAt" | "completedAt" | "durationMs">,
      ): ExecutionResult => ({
        ...partial,
        provider: "sambanova",
        action,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
      });

      if (action !== "GENERATE_TEXT") {
        return finish({
          status: "BLOCKED",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "AI_GENERATED",
          error: `action "${action}" is not allowlisted for sambanova`,
          usage: null,
          estimatedCost: null,
        });
      }
      if (!process.env.SAMBANOVA_API_KEY) {
        return finish({
          status: "UNAVAILABLE",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "AI_GENERATED",
          error: "sambanova: SAMBANOVA_API_KEY is not configured",
          usage: null,
          estimatedCost: null,
        });
      }

      const body = payload as { prompt?: unknown; system?: unknown } | null;
      const prompt = typeof body?.prompt === "string" ? body.prompt : "";
      if (!prompt.trim()) {
        return finish({
          status: "FAILED",
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "AI_GENERATED",
          error: "GENERATE_TEXT requires payload.prompt",
          usage: null,
          estimatedCost: null,
        });
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const response = await fetch(SAMBANOVA_BASE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SAMBANOVA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.SAMBANOVA_MODEL ?? DEFAULT_MODEL,
            messages: [
              ...(typeof body?.system === "string" && body.system.trim()
                ? [{ role: "system", content: body.system }]
                : []),
              { role: "user", content: prompt },
            ],
            stream: false,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!response.ok) {
          const errorClass = classifyHttpError(response.status, `HTTP ${response.status}`);
          return finish({
            status: errorClassToStatus(errorClass),
            externalId: null,
            output: null,
            rawDataAvailable: false,
            dataClass: "AI_GENERATED",
            error: sanitizeErrorMessage(`sambanova HTTP ${response.status}`),
            usage: null,
            estimatedCost: null,
          });
        }
        const data = (await response.json()) as {
          id?: string;
          choices?: Array<{ message?: { content?: string } }>;
          usage?: Record<string, number>;
        };
        const output = data.choices?.[0]?.message?.content ?? null;
        // Usage/cost only when the provider actually returned figures.
        const usage = data.usage && Object.keys(data.usage).length > 0 ? data.usage : null;
        return finish({
          status: "SUCCEEDED",
          externalId: data.id ?? null,
          output,
          rawDataAvailable: true,
          dataClass: "AI_GENERATED",
          error: null,
          usage,
          estimatedCost: null, // no verified price list → never invented
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution failed";
        const errorClass = classifyHttpError(null, message);
        return finish({
          status: errorClassToStatus(errorClass),
          externalId: null,
          output: null,
          rawDataAvailable: false,
          dataClass: "AI_GENERATED",
          error: sanitizeErrorMessage(message),
          usage: null,
          estimatedCost: null,
        });
      }
    },
  };
}
