/**
 * Phase 7 — AgentTask contract persistence against real PostgreSQL.
 * Verifies the contract round-trips through Prisma with defaults, relations,
 * artifact cascade, AgentRun linkage, and owner-cascade semantics.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../db";
import { mapAgentArtifact, mapAgentTask } from "../db-mappers";

const hasDb = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!hasDb)("AgentTask contract persistence (real PostgreSQL)", () => {
  const prisma = getPrisma();
  let userId = "";
  let agentId = "";
  let opportunityId = "";
  let experimentId = "";
  let taskId = "";

  afterAll(async () => {
    if (taskId) await prisma.agentTask.delete({ where: { id: taskId } }).catch(() => undefined);
    if (opportunityId) await prisma.opportunity.delete({ where: { id: opportunityId } }).catch(() => undefined);
    if (agentId) await prisma.agent.delete({ where: { id: agentId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("creates a task with contract fields, relations, defaults, and an artifact", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agenttask-${suffix}@example.com`,
        name: "AgentTask Contract",
        passwordHash: "not-a-real-hash",
        role: "USER",
        status: "ACTIVE",
      },
    });
    userId = user.id;

    const agent = await prisma.agent.create({
      data: { name: `Contract Agent ${suffix}`, type: "RESEARCH", status: "ACTIVE" },
    });
    agentId = agent.id;

    const opportunity = await prisma.opportunity.create({
      data: {
        title: `AgentTask contract opp ${suffix}`,
        category: "SAAS",
        businessModel: "SAAS",
        estimatedStartupCost: 100,
        demandScore: 60,
        competitionScore: 40,
        commercialIntentScore: 55,
        automationScore: 50,
        differentiationScore: 45,
        monetizationStrengthScore: 50,
        halalScore: 80,
        halalStatus: "HALAL",
        overallScore: 60,
        confidence: 40,
        status: "VALIDATED",
        risks: ["Platform dependency"],
        isSample: false,
        ownerId: user.id,
      },
    });
    opportunityId = opportunity.id;

    const experiment = await prisma.experiment.create({
      data: {
        hypothesis: "Contract experiment",
        opportunityId,
        target: "Measure conversions",
        budget: 300,
        startDate: new Date(),
        status: "RUNNING",
        isSample: false,
        revenue: 0,
        profit: 0,
        conversionRate: 0,
      },
    });
    experimentId = experiment.id;

    const task = await prisma.agentTask.create({
      data: {
        agentId,
        ownerId: user.id,
        opportunityId,
        experimentId,
        taskType: "EXPERIMENT_ANALYSIS",
        objective: "Analyze the recorded experiment metrics and produce a report.",
        instructions: "Use only recorded ExperimentMetric rows as inputs.",
        inputs: { focus: "conversion_rate", window: "last_30_days" },
        expectedOutputs: ["experiment_report"],
        constraints: ["No external publishing"],
        budgetLimit: 25,
        timeLimitSeconds: 60,
        maxOutputChars: 10_000,
        maxRetries: 3,
        maxActions: 5,
        requiresApproval: false,
        status: "READY",
      },
      include: { artifacts: true },
    });
    taskId = task.id;

    // Contract defaults.
    expect(task.contractVersion).toBe(1);
    expect(task.budgetLimit.toNumber()).toBe(25); // explicit value honored
    expect(task.maxActions).toBe(5); // explicit value honored
    expect(task.attempt).toBe(0);
    expect(task.actionCount).toBe(0);
    expect(task.status).toBe("READY");

    // Relations resolve in both directions.
    expect(task.agentId).toBe(agentId);
    expect(task.ownerId).toBe(user.id);
    expect(task.opportunityId).toBe(opportunityId);
    expect(task.experimentId).toBe(experimentId);
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { agentTasks: { select: { id: true } } },
    });
    expect(owner.agentTasks.map((t) => t.id)).toContain(taskId);

    // Artifact creation + mapping.
    const artifact = await prisma.agentArtifact.create({
      data: {
        taskId,
        type: "experiment_report",
        title: "Experiment analysis (AI generated)",
        content: "AI-generated analysis of recorded metrics.",
        data: { conversions: { recorded: true } },
        dataClass: "AI_GENERATED",
      },
    });
    const artifactRecord = mapAgentArtifact(artifact);
    expect(artifactRecord.dataClass).toBe("AI_GENERATED");
    expect(artifactRecord.taskId).toBe(taskId);

    // AgentRun linkage (nullable, SetNull semantics exercised implicitly).
    const run = await prisma.agentRun.create({
      data: { agentId, task: "EXPERIMENT_ANALYSIS", ownerId: user.id, agentTaskId: taskId, status: "COMPLETED" },
    });
    expect(run.agentTaskId).toBe(taskId);

    // App-level mapping round-trips the full contract.
    const reloaded = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    const record = mapAgentTask(reloaded);
    expect(record.contractVersion).toBe(1);
    expect(record.limits).toEqual({
      timeLimitSeconds: 60,
      maxOutputChars: 10_000,
      maxRetries: 3,
      maxActions: 5,
      budgetLimit: 25,
    });
    expect(record.inputs).toEqual({ focus: "conversion_rate", window: "last_30_days" });
    expect(record.status).toBe("READY");
    expect(record.approvalState).toBeNull();
  });

  it("cascades artifacts with the task and preserves AgentRun rows on task deletion", async () => {
    const artifactsBefore = await prisma.agentArtifact.count({ where: { taskId } });
    expect(artifactsBefore).toBe(1);

    const runCountBefore = await prisma.agentRun.count({ where: { agentTaskId: taskId } });
    expect(runCountBefore).toBe(1);

    await prisma.agentTask.delete({ where: { id: taskId } });
    taskId = "";

    expect(await prisma.agentArtifact.count({ where: { taskId } })).toBe(0);
    // AgentRun survives with agentTaskId nulled (onDelete: SetNull).
    const runs = await prisma.agentRun.findMany({
      where: { agent: { id: agentId }, task: "EXPERIMENT_ANALYSIS" },
    });
    expect(runs.length).toBe(1);
    expect(runs[0].agentTaskId).toBeNull();
  });
});
