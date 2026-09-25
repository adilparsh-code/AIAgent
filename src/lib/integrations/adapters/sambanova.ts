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
const SAMBANOVA_DEFAULT_BASE_URL = "https://api.sambanova.ai/v1/chat/completions";
const MAX_BASE_URL_LENGTH = 300;

/**
 * MEDIUM-8: `SAMBANOVA_BASE_URL` is documented in `docs/environment.md` and
 * `docs/PRODUCTION_ACTIVATION.md` as a supported override, and is advertised
 * in `SAMBANOVA_OPTIONAL_ENV_VARS`, but the constant was hardcoded and the
 * variable was never read. An operator who set it (for a regional endpoint, a
 * gateway, or a self-hosted OpenAI-compatible service) silently kept talking
 * to the public endpoint.
 *
 * The override is read at call time and fails closed: only an absolute `https:`
 * URL within a bounded length is honoured. Anything else falls back to the
 * default, so a typo cannot silently redirect provider traffic — and no
 * credential is ever sent to a non-https endpoint.
 */
export function resolveSambaNovaBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.SAMBANOVA_BASE_URL ?? "").trim();
  if (raw.length === 0 || raw.length > MAX_BASE_URL_LENGTH) return SAMBANOVA_DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname.length === 0) return SAMBANOVA_DEFAULT_BASE_URL;
    return url.toString();
  } catch {
    return SAMBANOVA_DEFAULT_BASE_URL;
  }
}
/**
 * Default model id. SambaNova rotates its catalogue, so a stale hardcoded id
 * is a real failure mode (the API answers 410/404 for retired models). This
 * default is a currently-served catalogue model; override with
 * SAMBANOVA_MODEL. When the default is stale the provider answers clearly and
 * the health check reports it honestly instead of pretending to be healthy.
 */
const DEFAULT_MODEL = "Meta-Llama-3.3-70B-Instruct";

export const SAMBANOVA_ENV_VARS = ["SAMBANOVA_API_KEY"] as const;
export const SAMBANOVA_OPTIONAL_ENV_VARS = ["SAMBANOVA_BASE_URL", "SAMBANOVA_MODEL", "AI_PROVIDER_ENV"] as const;

/**
 * Classify a failed health probe into an operator-actionable (still secret-free)
 * message. Never includes response bodies that could echo a credential.
 */
export function describeProbeFailure(status: number, model: string): string {
  if (status === 402) {
    return "sambanova health probe HTTP 402: key authenticated but the account has no credits/subscription (billing required)";
  }
  if (status === 404) {
    return `sambanova health probe HTTP 404: model "${model}" is not available to this account (set SAMBANOVA_MODEL to a model from your catalogue)`;
  }
  if (status === 410) {
    return `sambanova health probe HTTP 410: model "${model}" has been retired (set SAMBANOVA_MODEL to a current catalogue model)`;
  }
  if (status === 429) {
    return "sambanova health probe HTTP 429: rate limited";
  }
  if (status === 401 || status === 403) {
    return `sambanova health probe HTTP ${status}: credentials rejected`;
  }
  return `sambanova health probe HTTP ${status}`;
}

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
        const response = await fetch(resolveSambaNovaBaseUrl(), {
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
          // Actionable, sanitized probe failures. 402 = the key authenticated
          // but the account has no credits/subscription (billing, not auth);
          // 404/410 = the model id is retired or unavailable.
          error: response.ok ? null : sanitizeErrorMessage(describeProbeFailure(response.status, process.env.SAMBANOVA_MODEL ?? DEFAULT_MODEL)),
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
        const response = await fetch(resolveSambaNovaBaseUrl(), {
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
            error: sanitizeErrorMessage(
              describeProbeFailure(response.status, process.env.SAMBANOVA_MODEL ?? DEFAULT_MODEL).replace("health probe", "execution"),
            ),
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
