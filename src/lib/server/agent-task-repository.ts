import "server-only";

import { getPrisma } from "@/lib/db";
import type { AgentTaskRecord, AgentTaskStatus } from "@/lib/agent-task";

function map(row: any): AgentTaskRecord {
  return {
    id: row.id,
    contractVersion: row.contractVersion,
    agentId: row.agentId,
    ownerId: row.ownerId,
    opportunityId: row.opportunityId,
    experimentId: row.experimentId,
    taskType: row.taskType,
    objective: row.objective,
    instructions: row.instructions,
    inputs: row.inputs ?? {},
    expectedOutputs: row.expectedOutputs,
    constraints: row.constraints,
    limits: {
      budgetLimit: Number(row.budgetLimit),
      timeLimitSeconds: row.timeLimitSeconds,
      maxOutputChars: row.maxOutputChars,
      maxRetries: row.maxRetries,
      maxActions: row.maxActions,
    },
    requiresApproval: row.requiresApproval,
    blockedReason: row.blockedReason,
    approvalState: row.approvalState === "APPROVED" || row.approvalState === "REJECTED" ? row.approvalState : null,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    status: row.status,
    attempt: row.attempt,
    actionCount: row.actionCount,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    result: row.result,
    errors: row.errors,
    cancellation: row.cancellation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAgentTasks(ownerId: string, status?: AgentTaskStatus, limit = 50) {
  const rows = await getPrisma().agentTask.findMany({
    where: { ownerId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: { artifacts: true },
  });
  return rows.map(map);
}

export async function getAgentTask(id: string, ownerId: string) {
  const row = await getPrisma().agentTask.findFirst({
    where: { id, ownerId },
    include: { artifacts: true },
  });
  return row ? map(row) : null;
}

export async function createAgentTask(data: {
  agentId: string; ownerId: string; opportunityId?: string; experimentId?: string;
  taskType: any; objective: string; instructions: string; inputs?: unknown;
  expectedOutputs: string[]; constraints: string[]; budgetLimit: number;
  timeLimitSeconds: number; maxOutputChars: number; maxRetries: number; maxActions: number;
  requiresApproval: boolean;
}) {
  const row = await getPrisma().agentTask.create({
    data: {
      agentId: data.agentId, ownerId: data.ownerId, opportunityId: data.opportunityId,
      experimentId: data.experimentId, taskType: data.taskType, objective: data.objective,
      instructions: data.instructions, inputs: data.inputs as any,
      expectedOutputs: data.expectedOutputs, constraints: data.constraints,
      budgetLimit: data.budgetLimit, timeLimitSeconds: data.timeLimitSeconds,
      maxOutputChars: data.maxOutputChars, maxRetries: data.maxRetries,
      maxActions: data.maxActions, requiresApproval: data.requiresApproval,
      status: data.requiresApproval ? "WAITING_APPROVAL" : "READY",
      approvalState: null,
    },
  });
  return map(row);
}

export async function setApproval(id: string, ownerId: string, approved: boolean, userId: string, reason?: string) {
  const prisma = getPrisma();
  const existing = await prisma.agentTask.findFirst({ where: { id, ownerId } });
  if (!existing) return null;
  if (!["QUEUED", "READY", "WAITING_APPROVAL"].includes(existing.status)) {
    throw new Error("Task is not awaiting an approval decision");
  }
  if (approved) {
    const row = await prisma.agentTask.update({
      where: { id },
      data: { status: "READY", approvalState: "APPROVED", approvedBy: userId, approvedAt: new Date(), rejectionReason: null },
    });
    return map(row);
  }
  const row = await prisma.agentTask.update({
    where: { id },
    data: { status: "CANCELLED", approvalState: "REJECTED", approvedBy: null, approvedAt: null, rejectionReason: (reason || "Rejected by user").slice(0, 500) },
  });
  return map(row);
}

export async function cancelAgentTask(id: string, ownerId: string, reason = "Cancelled by user") {
  const prisma = getPrisma();
  const existing = await prisma.agentTask.findFirst({ where: { id, ownerId } });
  if (!existing) return null;
  if (existing.status === "RUNNING") throw new Error("Running tasks cannot be cancelled through this endpoint");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(existing.status)) throw new Error("Task is already terminal");
  const row = await prisma.agentTask.update({ where: { id }, data: { status: "CANCELLED", cancellation: reason.slice(0, 500) } });
  return map(row);
}
