import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Optional seed script. NEVER run automatically — sample data must never be
 * silently inserted into a production database. Records created here are
 * labeled with isSample: true and "SAMPLE DATA" in their notes so they are
 * always distinguishable from real user data.
 *
 * Usage: npx prisma db seed   (or: npm run db:seed)
 */
const prisma = new PrismaClient();

const SAMPLE_OPPORTUNITY_ID = "sample-opp-001";

async function main() {
  console.log("Seeding clearly-labeled SAMPLE data (isSample: true)...");

  const opportunity = await prisma.opportunity.upsert({
    where: { id: SAMPLE_OPPORTUNITY_ID },
    create: {
      id: SAMPLE_OPPORTUNITY_ID,
      title: "SAMPLE DATA — Homeschool Phonics Worksheet Packs",
      category: "EDUCATIONAL_RESOURCES",
      businessModel: "DIGITAL_PRODUCT",
      targetAudience: "Homeschooling parents of children ages 4-7",
      problemSolved: "SAMPLE DATA — structured phonics practice without curriculum subscription",
      monetizationMethod: "SAMPLE DATA — one-time worksheet pack sales on a marketplace",
      estimatedStartupCost: 50,
      demandScore: 70,
      competitionScore: 55,
      commercialIntentScore: 65,
      automationScore: 60,
      differentiationScore: 50,
      monetizationStrengthScore: 55,
      halalScore: 80,
      halalStatus: "REVIEW_REQUIRED",
      overallScore: 61.3,
      confidence: 50,
      status: "IDEA",
      evidence: ["SAMPLE DATA — placeholder evidence string, not research output"],
      risks: ["SAMPLE DATA — placeholder risk string"],
      nextAction: "SAMPLE DATA — run live research to replace placeholder judgment",
      isSample: true,
    },
    update: {},
  });

  const product = await prisma.product.upsert({
    where: { id: "sample-prod-001" },
    create: {
      id: "sample-prod-001",
      name: "SAMPLE DATA — CVC Word Families Pack 1",
      type: "WORKSHEET",
      targetAudience: "Children ages 4-6",
      opportunityId: opportunity.id,
      status: "PLANNED",
      price: 6.99,
      cost: 0,
      revenue: 0,
      platform: "",
      notes: "SAMPLE DATA — planned first product",
      isSample: true,
    },
    update: {},
  });

  await prisma.experiment.upsert({
    where: { id: "sample-exp-001" },
    create: {
      id: "sample-exp-001",
      hypothesis: "SAMPLE DATA — Pack 1 sells 10 copies in 30 days on marketplace",
      opportunityId: opportunity.id,
      target: "10 sales in 30 days",
      budget: 0,
      startDate: new Date("2026-10-01T00:00:00Z"),
      expectedResult: "SAMPLE DATA — 10 sales, ~$70 revenue",
      status: "PLANNED",
      revenue: 0,
      profit: 0,
      conversionRate: 0,
      isSample: true,
    },
    update: {},
  });

  await prisma.revenueEntry.upsert({
    where: { id: "sample-rev-001" },
    create: {
      id: "sample-rev-001",
      date: new Date("2026-10-15T00:00:00Z"),
      productId: product.id,
      opportunityId: opportunity.id,
      revenueSource: "PRODUCT_SALES",
      grossRevenue: 69.9,
      fees: 5.94,
      advertisingCost: 0,
      otherCosts: 0,
      netRevenue: 63.96,
      currency: "USD",
      referenceNote: "SAMPLE DATA — illustrative first month royalties",
      isSample: true,
    },
    update: {},
  });

  await prisma.agent.upsert({
    where: { id: "sample-agent-001" },
    create: {
      id: "sample-agent-001",
      name: "SAMPLE DATA — Research Agent",
      type: "RESEARCH",
      description: "SAMPLE DATA — placeholder row for agent persistence demo",
      status: "DISABLED",
      placeholder: true,
      isSample: true,
    },
    update: {},
  });

  console.log("Seed complete. All rows are labeled SAMPLE DATA and never appear as real records.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
