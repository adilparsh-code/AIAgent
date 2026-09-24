import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import {
  canTransitionExecution,
  type AgentExecutionResult,
  type AgentExecutionStatus,
} from "@/lib/execution-contract";

/**
 * Phase 9A — AgentExecution persistence.
 *
 * Guarantees (tested against real PostgreSQL):
 * - Idempotency: the idempotencyKey is UNIQUE; a duplicate create resolves to
 *   the existing row instead of creating a second execution.
 * - Deterministic state machine: updates are compare-and-swap — the row moves
 *   only when the transition is legal, so concurrent writers cannot corrupt
 *   the lifecycle. Illegal transitions throw.
 * - Secrets are never stored: callers persist sanitized summaries only.
 */

/** Row shape the mappers/tests rely on (subset of the Prisma model). */
export interface AgentExecutionRow {
  id: string;
  version: number;
  taskId: string;
  ownerId: string;
  opportunityId: string | null;
  experimentId: string | null;
  integration: string;
  action: string;
  capability: string | null;
  approvalStatus: string;
  idempotencyKey: string;
  status: AgentExecutionStatus;
  mode: string;
  dryRun: boolean;
  retryCount: number;
  maxAttempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  result: unknown;
  error: string | null;
  dataClass: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class IllegalExecutionTransitionError extends Error {
  readonly from: AgentExecutionStatus;
  readonly to: AgentExecutionStatus;
  constructor(from: AgentExecutionStatus, to: AgentExecutionStatus) {
    super(`illegal AgentExecution transition ${from} → ${to}`);
    this.name = "IllegalExecutionTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Create an execution row, or resolve the existing one for the same
 * idempotency key. Returns the row plus whether it was newly created, so the
 * orchestrator can distinguish "started fresh" from "duplicate request".
 */
export async function createExecutionIdempotent(data: {
  taskId: string;
  ownerId: string;
  opportunityId: string | null;
  experimentId: string | null;
  integration: string;
  action: string;
  capability: string | null;
  approvalStatus: string;
  idempotencyKey: string;
  mode: string;
  dryRun: boolean;
  maxAttempts: number;
}): Promise<{ execution: AgentExecutionRow; created: boolean }> {
  const prisma = getPrisma();
  const base = {
    taskId: data.taskId,
    ownerId: data.ownerId,
    opportunityId: data.opportunityId,
    experimentId: data.experimentId,
    integration: data.integration,
    action: data.action,
    capability: data.capability,
    approvalStatus: data.approvalStatus,
    idempotencyKey: data.idempotencyKey,
    mode: data.mode,
    dryRun: data.dryRun,
    maxAttempts: data.maxAttempts,
    status: "QUEUED" as const,
  };
  try {
    const row = await prisma.agentExecution.create({ data: base });
    return { execution: row as AgentExecutionRow, created: true };
  } catch (error) {
    // Unique violation on idempotencyKey → concurrent duplicate: return the
    // existing row (which belongs to the same owner by key construction).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.agentExecution.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing && existing.ownerId === data.ownerId && existing.taskId === data.taskId) {
        return { execution: existing as AgentExecutionRow, created: false };
      }
    }
    throw error;
  }
}

/**
 * Compare-and-swap a state transition. The update applies only when the row
 * is still in `from`; a concurrent writer having moved it on surfaces as an
 * IllegalExecutionTransitionError carrying the current state.
 */
export async function transitionExecution(
  executionId: string,
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
  patch: Prisma.AgentExecutionUpdateInput = {},
): Promise<AgentExecutionRow> {
  if (!canTransitionExecution(from, to)) {
    throw new IllegalExecutionTransitionError(from, to);
  }
  const prisma = getPrisma();
  const result = await prisma.agentExecution.updateMany({
    where: { id: executionId, status: from },
    data: { ...patch, status: to },
  });
  if (result.count === 0) {
    const current = await prisma.agentExecution.findUnique({ where: { id: executionId } });
    const actual = (current?.status as AgentExecutionStatus | undefined) ?? "QUEUED";
    throw new IllegalExecutionTransitionError(actual, to);
  }
  const row = await prisma.agentExecution.findUniqueOrThrow({ where: { id: executionId } });
  return row as AgentExecutionRow;
}

/** Finalize an execution with its result/error (any legal terminal state). */
export async function finalizeExecution(
  executionId: string,
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
  data: {
    result?: AgentExecutionResult | null;
    error?: string | null;
    dataClass?: string | null;
    startedAt?: Date | null;
  },
): Promise<AgentExecutionRow> {
  return transitionExecution(executionId, from, to, {
    completedAt: new Date(),
    ...(data.result !== undefined ? { result: data.result as unknown as Prisma.InputJsonValue } : {}),
    ...(data.error !== undefined ? { error: data.error } : {}),
    ...(data.dataClass !== undefined ? { dataClass: data.dataClass } : {}),
    ...(data.startedAt ? { startedAt: data.startedAt } : {}),
  });
}

export async function getExecutionByIdempotencyKey(idempotencyKey: string): Promise<AgentExecutionRow | null> {
  const row = await getPrisma().agentExecution.findUnique({ where: { idempotencyKey } });
  return row ? (row as AgentExecutionRow) : null;
}

export async function getExecutionById(id: string, ownerId: string): Promise<AgentExecutionRow | null> {
  const row = await getPrisma().agentExecution.findFirst({ where: { id, ownerId } });
  return row ? (row as AgentExecutionRow) : null;
}

export async function listExecutionsForTask(taskId: string, ownerId: string, limit = 20): Promise<AgentExecutionRow[]> {
  const rows = await getPrisma().agentExecution.findMany({
    where: { taskId, ownerId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows as AgentExecutionRow[];
}

export async function listExecutionsForOwner(ownerId: string, limit = 50): Promise<AgentExecutionRow[]> {
  const rows = await getPrisma().agentExecution.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows as AgentExecutionRow[];
}

/** Build a new execution id (cuid from Prisma is the default; this is explicit for tests). */
export function newExecutionId(): string {
  return randomUUID();
}
