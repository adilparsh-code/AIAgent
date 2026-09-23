/**
 * Phase 7 — AgentTask Contract (machine-readable, versioned).
 *
 * An AgentTask is a unit of agent work inside the controlled runtime. The
 * contract is explicit and bounded: allowlisted taskType, declared limits,
 * optional approval gate. The runtime only executes tasks whose taskType is
 * in AGENT_TASK_TYPES — anything else is rejected at the boundary. Nothing
 * here executes on its own; ownership is always assigned server-side from
 * the authenticated session, never from client input.
 */

/** Bumped whenever the contract shape changes incompatibly. */
export const AGENT_TASK_CONTRACT_VERSION = 1;

/** Lifecycle of an AgentTask. Mirrors the Prisma `AgentTaskStatus` enum. */
export type AgentTaskStatus =
  | "QUEUED"
  | "READY"
  | "WAITING_APPROVAL"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

/**
 * Allowlisted task types. The runtime has exactly one handler per type and
 * executes nothing else — user-supplied "actions" are never executed.
 */
export const AGENT_TASK_TYPES = [
  "RESEARCH",
  "CONTENT_DRAFT",
  "PRODUCT_OUTLINE",
  "LANDING_PAGE_DRAFT",
  "SEO_RESEARCH",
  "AFFILIATE_RESEARCH",
  "PIN_CONTENT_DRAFT",
  "EXPERIMENT_ANALYSIS",
  "REPORT_GENERATION",
] as const;

export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export function isAgentTaskType(value: unknown): value is AgentTaskType {
  return typeof value === "string" && (AGENT_TASK_TYPES as readonly string[]).includes(value);
}

/**
 * Artifact data classes. AI output is NEVER presented as real-world evidence:
 * `AI_GENERATED` / `AI_ESTIMATE` are clearly separated from `REAL_DATA`
 * measurements and `SAMPLE_DATA` demo rows.
 */
export const AGENT_ARTIFACT_DATA_CLASSES = [
  "REAL_DATA",
  "AI_GENERATED",
  "AI_ESTIMATE",
  "SAMPLE_DATA",
] as const;

export type AgentArtifactDataClass = (typeof AGENT_ARTIFACT_DATA_CLASSES)[number];

export function isAgentArtifactDataClass(value: unknown): value is AgentArtifactDataClass {
  return (
    typeof value === "string" &&
    (AGENT_ARTIFACT_DATA_CLASSES as readonly string[]).includes(value)
  );
}

/** Artifact types the runtime can produce (mirrors the task allowlist). */
export const AGENT_ARTIFACT_TYPES = [
  "research_report",
  "content_draft",
  "product_outline",
  "landing_page_draft",
  "seo_research",
  "affiliate_research_report",
  "pin_content_draft",
  "experiment_report",
  "generated_copy",
  "structured_json",
] as const;

export type AgentArtifactType = (typeof AGENT_ARTIFACT_TYPES)[number];

/**
 * Declared limits for one task. Defaults are intentionally tight; the budget
 * defaults to ZERO — spending requires an explicit, approved amount.
 */
export interface AgentTaskLimits {
  /** Wall-clock execution budget in seconds (server-enforced). */
  timeLimitSeconds: number;
  /** Hard cap on persisted output size, in characters. */
  maxOutputChars: number;
  /** Maximum execution attempts (including the first). */
  maxRetries: number;
  /** Maximum distinct actions one execution may perform. */
  maxActions: number;
  /** Monetary budget in the account currency. Default 0 = nothing spendable. */
  budgetLimit: number;
}

export const AGENT_TASK_LIMIT_DEFAULTS: AgentTaskLimits = {
  timeLimitSeconds: 120,
  maxOutputChars: 20_000,
  maxRetries: 2,
  maxActions: 10,
  budgetLimit: 0,
};

export const AGENT_TASK_LIMIT_BOUNDS = {
  timeLimitSeconds: { min: 5, max: 900 },
  maxOutputChars: { min: 500, max: 100_000 },
  maxRetries: { min: 1, max: 5 },
  maxActions: { min: 1, max: 50 },
  budgetLimit: { min: 0, max: 1_000_000 },
} as const;

/** Full contract for one unit of agent work (app-level shape). */
export interface AgentTaskRecord {
  id: string;
  contractVersion: number;
  agentId: string;
  ownerId: string;
  opportunityId: string | null;
  experimentId: string | null;
  taskType: AgentTaskType;
  objective: string;
  instructions: string;
  /** Structured, size-capped inputs (untrusted content is treated as data). */
  inputs: unknown;
  expectedOutputs: string[];
  constraints: string[];
  limits: AgentTaskLimits;
  requiresApproval: boolean;
  /** Why the task is blocked, when status is BLOCKED. */
  blockedReason: string | null;
  /** Approval lifecycle: null until a decision is recorded. */
  approvalState: "APPROVED" | "REJECTED" | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  status: AgentTaskStatus;
  /** Executions attempted so far (capped by maxRetries). */
  attempt: number;
  actionCount: number;
  lastAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** Execution summary: what ran, what it produced, what remains (Phase 7). */
  result: unknown;
  errors: string[];
  cancellation: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A safe artifact produced by a task. */
export interface AgentArtifactRecord {
  id: string;
  taskId: string;
  type: AgentArtifactType;
  title: string;
  content: string;
  data: unknown;
  dataClass: AgentArtifactDataClass;
  createdAt: string;
}

/** Execution summary stored in AgentTask.result — concise, no hidden traces. */
export interface AgentTaskExecutionResult {
  summary: string;
  providerName: string | null;
  providerModel: string | null;
  artifactsCreated: number;
  actionsPerformed: string[];
  remainingWork: string | null;
  dataClass: AgentArtifactDataClass;
}

/** Client input for creating a task (ownership/limits are NOT client-settable). */
export interface AgentTaskCreateInput {
  agentId: string;
  taskType: AgentTaskType;
  objective: string;
  instructions?: string;
  inputs?: unknown;
  expectedOutputs?: string[];
  constraints?: string[];
  opportunityId?: string;
  experimentId?: string;
  /** Requested approval requirement; the server may force approval upward. */
  requiresApproval?: boolean;
  /** Requested limits, clamped server-side to safe bounds. */
  limits?: Partial<AgentTaskLimits>;
}

const OBJECTIVE_MAX = 600;
const TEXT_FIELD_MAX = 4_000;
const INPUTS_MAX_CHARS = 20_000;
const LIST_MAX_ITEMS = 20;
const LIST_ITEM_MAX = 200;

/** Validation failure with a field-level reason (surfaced as 400/422). */
export class AgentTaskValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AgentTaskValidationError";
    this.field = field;
  }
}

function requireNonEmptyText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AgentTaskValidationError(field, `${field} is required`);
  }
  if (value.length > max) {
    throw new AgentTaskValidationError(field, `${field} exceeds ${max} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new AgentTaskValidationError(field, `${field} must be a string`);
  }
  if (value.length > max) {
    throw new AgentTaskValidationError(field, `${field} exceeds ${max} characters`);
  }
  return value.trim();
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentTaskValidationError(field, `${field} must be an array of strings`);
  }
  if (value.length > LIST_MAX_ITEMS) {
    throw new AgentTaskValidationError(field, `${field} accepts at most ${LIST_MAX_ITEMS} items`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new AgentTaskValidationError(field, `${field}[${index}] must be a string`);
    }
    if (item.length > LIST_ITEM_MAX) {
      throw new AgentTaskValidationError(field, `${field}[${index}] exceeds ${LIST_ITEM_MAX} characters`);
    }
    return item.trim();
  });
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 64) {
    throw new AgentTaskValidationError(field, `${field} must be an id of at most 64 characters`);
  }
  return value;
}

/**
 * Validate and normalize client input into a safe create payload. Ownership
 * (ownerId), the effective limits, and the approval decision are resolved by
 * the server — this function only bounds and types the client-supplied part.
 */
export function validateAgentTaskCreate(raw: unknown): Required<
  Pick<AgentTaskCreateInput, "agentId" | "taskType" | "objective">
> &
  Pick<
    AgentTaskCreateInput,
    "instructions" | "inputs" | "expectedOutputs" | "constraints" | "opportunityId" | "experimentId" | "requiresApproval" | "limits"
  > {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentTaskValidationError("body", "request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;

  const agentId = requireNonEmptyText(body.agentId, "agentId", 64);
  if (!isAgentTaskType(body.taskType)) {
    throw new AgentTaskValidationError(
      "taskType",
      `taskType must be one of: ${AGENT_TASK_TYPES.join(", ")}`,
    );
  }
  const objective = requireNonEmptyText(body.objective, "objective", OBJECTIVE_MAX);
  const instructions = optionalText(body.instructions, "instructions", TEXT_FIELD_MAX);

  // Inputs: JSON only, size-capped. Never executed — passed to handlers as data.
  let inputs: unknown;
  if (body.inputs !== undefined) {
    if (body.inputs === null || typeof body.inputs !== "object" || Array.isArray(body.inputs)) {
      throw new AgentTaskValidationError("inputs", "inputs must be a JSON object");
    }
    const serialized = JSON.stringify(body.inputs);
    if (serialized.length > INPUTS_MAX_CHARS) {
      throw new AgentTaskValidationError("inputs", `inputs exceed ${INPUTS_MAX_CHARS} characters`);
    }
    inputs = body.inputs;
  }

  const expectedOutputs = stringList(body.expectedOutputs, "expectedOutputs");
  const constraints = stringList(body.constraints, "constraints");
  const opportunityId = optionalId(body.opportunityId, "opportunityId");
  const experimentId = optionalId(body.experimentId, "experimentId");
  const requiresApproval =
    body.requiresApproval === undefined ? undefined : Boolean(body.requiresApproval);

  let limits: Partial<AgentTaskLimits> | undefined;
  if (body.limits !== undefined) {
    if (body.limits === null || typeof body.limits !== "object" || Array.isArray(body.limits)) {
      throw new AgentTaskValidationError("limits", "limits must be a JSON object");
    }
    const rawLimits = body.limits as Record<string, unknown>;
    limits = {};
    for (const key of Object.keys(AGENT_TASK_LIMIT_DEFAULTS) as Array<keyof AgentTaskLimits>) {
      const value = rawLimits[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AgentTaskValidationError(`limits.${key}`, `limits.${key} must be a finite number`);
      }
      const { min, max } = AGENT_TASK_LIMIT_BOUNDS[key];
      if (value < min || value > max) {
        throw new AgentTaskValidationError(
          `limits.${key}`,
          `limits.${key} must be between ${min} and ${max}`,
        );
      }
      limits[key] = value;
    }
  }

  return {
    agentId,
    taskType: body.taskType,
    objective,
    instructions,
    inputs,
    expectedOutputs,
    constraints,
    opportunityId,
    experimentId,
    requiresApproval,
    limits,
  };
}
