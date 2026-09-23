import { config } from "dotenv";
config({ path: ".env.local" });
import { execSync } from "node:child_process";
import { URL } from "node:url";

/**
 * One-off local verification: deploy the complete migration set into an EMPTY
 * schema (auth_check on the disposable shadow_db) to prove the migrations work
 * from a clean state — including User/Session and all ownership columns.
 * The real DATABASE_URL is never printed.
 */
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const url = new URL(raw);
url.pathname = "/shadow_db";
url.searchParams.set("schema", "auth_check");

const out = execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
  env: { ...process.env, DATABASE_URL: url.toString() },
  encoding: "utf8",
  timeout: 110_000,
  cwd: process.cwd(),
});
const lines = out.split("\n").filter((line) => /migration|applied|Database/i.test(line));
console.log(lines.join("\n"));

// Sanity-check the fresh schema end to end via Prisma Client.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const user = await prisma.user.create({
  data: { email: "clean-check@example.com", passwordHash: "scrypt$16384$8$1$aa$bb", name: "Clean Check" },
});
const opp = await prisma.opportunity.create({
  data: {
    title: "Clean check",
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
    overallScore: 62.5,
    confidence: 40,
    status: "IDEA",
    ownerId: user.id,
  },
});
const session = await prisma.session.create({
  data: { tokenHash: "clean-check-hash", userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
});
console.log(
  JSON.stringify({
    userCreated: true,
    opportunityOwned: opp.ownerId === user.id,
    sessionCreated: Boolean(session.tokenHash),
  }),
);
await prisma.user.delete({ where: { id: user.id } }); // cascades session; sets opp.ownerId null
console.log("cascade cleanup ok");
await prisma.$disconnect();
