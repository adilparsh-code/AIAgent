import "server-only";

import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai-provider";
import type { AgentTaskExecutionResult } from "@/lib/agent-task";
import { classifyFailure } from "@/lib/failure-classification";

const APPROVAL_REQUIRED_TYPES = new Set<string>();

function safeArtifactType(taskType: string) {
  const map: Record<string, string> = {
    RESEARCH: "research_report",
    CONTENT_DRAFT: "content_draft",
    PRODUCT_OUTLINE: "product_outline",
    LANDING_PAGE_DRAFT: "landing_page_draft",
    SEO_RESEARCH: "seo_research",
    AFFILIATE_RESEARCH: "affiliate_research_report",
    PIN_CONTENT_DRAFT: "pin_content_draft",
    EXPERIMENT_ANALYSIS: "experiment_report",
    REPORT_GENERATION: "generated_copy",
  };
  return map[taskType] || "structured_json";
}

function ensureNoForbiddenInstructions(instructions: string) {
  const text = instructions.toLowerCase();
  const forbidden = [
    "execute_shell", "execute shell", "run command", "powershell", "bash ",
    "rm -rf", "curl ", "wget ", "send email", "publish", "buy ", "purchase ",
    "spend money", "api key", "password", "secret",
  ];
  if (forbidden.some((term) => text.includes(term))) {
    throw new Error("Task instructions contain a forbidden external-action or secret-access request");
  }
}

export async function executeAgentTask(id: string, ownerId: string) {
  const prisma = getPrisma();
  const task = await prisma.agentTask.findFirst({
    where: { id, ownerId },
    include: { agent: true },
  });
  if (!task) return null;

  if (task.requiresApproval && task.approvalState !== "APPROVED") {
    throw new Error("Task requires approval before execution");
  }
  if (!["READY", "QUEUED"].includes(task.status)) throw new Error(`Task cannot execute from status ${task.status}`);
  if (task.attempt >= task.maxRetries) throw new Error("Task retry limit reached");
  if (APPROVAL_REQUIRED_TYPES.has(task.taskType) && task.approvalState !== "APPROVED") {
    throw new Error("Task type requires explicit approval");
  }

  ensureNoForbiddenInstructions(task.instructions);

  const startedAt = new Date();
  const runId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.agentTask.update({
      where: { id },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        actionCount: { increment: 1 },
        lastAttemptAt: startedAt,
        startedAt,
        errors: [],
      },
    });
    await tx.agentRun.create({
      data: {
        id: runId,
        agentId: task.agentId,
        agentTaskId: task.id,
        ownerId,
        task: task.objective,
        status: "RUNNING",
        input: task.inputs as any,
        metadata: { contractVersion: task.contractVersion, taskType: task.taskType },
      },
    });
  });

  const provider = getAIProvider();
  try {
    const health = await provider.health();
    if (health.status !== "HEALTHY") throw new Error(health.reason || "AI provider unavailable");

    const result = await provider.generate({
      objective: task.objective,
      instructions: task.instructions,
      inputs: task.inputs ?? {},
      maxOutputChars: task.maxOutputChars,
    });

    const execution: AgentTaskExecutionResult = {
      summary: result.text.slice(0, 2_000),
      providerName: result.providerName,
      providerModel: result.model,
      artifactsCreated: 1,
      actionsPerformed: ["AI_PROVIDER_GENERATE"],
      remainingWork: null,
      dataClass: "AI_GENERATED",
    };
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await prisma.$transaction(async (tx) => {
      await tx.agentTask.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt,
          durationMs,
          result: execution as any,
          errors: [],
        },
      });
      await tx.agentArtifact.create({
        data: {
          taskId: id,
          type: safeArtifactType(task.taskType),
          title: task.objective.slice(0, 200),
          content: result.text.slice(0, task.maxOutputChars),
          dataClass: "AI_GENERATED",
        },
      });
      await tx.agentRun.update({
        where: { id: runId },
        data: { status: "COMPLETED", completedAt, output: execution as any, metadata: { provider: result.providerName, model: result.model } },
      });
    });

    return execution;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Task execution failed";
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const latest = await prisma.agentTask.findUnique({ where: { id } });
    const classification = classifyFailure(error);
    const retryable = Boolean(
      latest &&
      classification.retryable &&
      latest.attempt < latest.maxRetries,
    );
    await prisma.$transaction(async (tx) => {
      await tx.agentTask.update({
        where: { id },
        data: {
          status: retryable ? (latest?.requiresApproval ? "WAITING_APPROVAL" : "READY") : "FAILED",
          completedAt,
          durationMs,
          errors: [message],
        },
      });
      await tx.agentRun.update({ where: { id: runId }, data: { status: "FAILED", completedAt, errors: [message] } });
    });
    throw error;
  }
}
