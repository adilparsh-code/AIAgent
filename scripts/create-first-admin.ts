/**
 * One-time first-administrator bootstrap (operator command).
 *
 * Usage (from the repository, with DATABASE_URL configured):
 *
 *   ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN \
 *     npm run admin:create -- --email owner@example.com
 *
 * The password is prompted for with hidden input (preferred) or supplied by
 * the process environment for non-interactive provisioning:
 *
 *   ADMIN_BOOTSTRAP_PASSWORD='...' \
 *   ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN \
 *     npm run admin:create -- --email owner@example.com --name "Owner"
 *
 * Safety:
 * - Fails closed unless an ADMIN account does not already exist.
 * - Never prints the password or password hash, and never writes either to disk.
 * - Refuses to run without the explicit confirmation phrase.
 * - No HTTP endpoint exists, so the public internet cannot trigger this.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  ADMIN_BOOTSTRAP_CONFIRMATION,
  AdminBootstrapError,
  createFirstAdmin,
} from "../src/lib/server/admin-bootstrap";

interface Args {
  email?: string;
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--email") args.email = argv[++i];
    else if (token === "--name") args.name = argv[++i];
    else if (token.startsWith("--email=")) args.email = token.slice("--email=".length);
    else if (token.startsWith("--name=")) args.name = token.slice("--name=".length);
  }
  return args;
}

function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (fromEnv) {
    // Reduce the window in which the value sits on this process's env copy.
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    return fromEnv;
  }

  if (process.stdin.isTTY) {
    const first = await promptHidden("Administrator password (hidden): ");
    const second = await promptHidden("Confirm password (hidden): ");
    if (first !== second) throw new Error("Passwords did not match.");
    return first;
  }

  // Non-interactive fallback: a single line piped on stdin.
  process.stderr.write("Reading administrator password from stdin...\n");
  return new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    let buffer = "";
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not configured. Set it in the deployment environment (never hardcode it).",
    );
    process.exitCode = 1;
    return;
  }
  if (!args.email) {
    console.error("Usage: npm run admin:create -- --email <admin@example.com> [--name <name>]");
    process.exitCode = 1;
    return;
  }

  const confirmation = process.env.ADMIN_BOOTSTRAP_CONFIRM;
  const password = await readPassword();

  const prisma = new PrismaClient();
  try {
    const admin = await createFirstAdmin(prisma, {
      email: args.email,
      name: args.name,
      password,
      confirmation,
    });
    console.log("First administrator created.");
    console.log(`  id:    ${admin.id}`);
    console.log(`  email: ${admin.email}`);
    console.log(`  role:  ${admin.role}`);
    console.log("Bootstrap is now closed; this command will refuse to run again while an admin exists.");
    console.log("Next: sign in and enroll two-factor authentication in Settings.");
  } catch (error) {
    if (error instanceof AdminBootstrapError) {
      console.error(`Refused: ${error.message}`);
      console.error(`Code: ${error.code}`);
    } else {
      // Deliberately avoid echoing arbitrary error text: database errors can
      // contain connection details. Operators can inspect server logs.
      console.error(
        "First-admin bootstrap failed. Details withheld to avoid leaking credentials; check DATABASE_URL and database availability.",
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
