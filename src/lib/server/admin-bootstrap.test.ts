import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  ADMIN_BOOTSTRAP_CONFIRMATION,
  AdminBootstrapError,
  createFirstAdmin,
} from "./admin-bootstrap";
import { verifyPassword } from "./password";

interface FakeUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
}

/**
 * Minimal in-memory stand-in for the parts of PrismaClient used by the
 * bootstrap. Transactions are serialized through a promise chain so the
 * concurrent-bootstrap test exercises the same "one wins" guarantee the
 * PostgreSQL advisory lock provides in production.
 */
function makeFakePrisma(seed: FakeUser[] = []) {
  const users: FakeUser[] = [...seed];
  let nextId = 1;
  let chain: Promise<unknown> = Promise.resolve();

  const tx = {
    $executeRawUnsafe: async () => 1,
    user: {
      findFirst: async ({ where }: { where: { role: "USER" | "ADMIN" } }) =>
        users.find((user) => user.role === where.role) ?? null,
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((user) => user.email === where.email) ?? null,
      create: async ({ data }: { data: Omit<FakeUser, "id"> }) => {
        const user: FakeUser = { id: `user-${nextId++}`, ...data };
        users.push(user);
        return { id: user.id, email: user.email, role: user.role };
      },
    },
  };

  const prisma = {
    $transaction: async <T>(
      fn: (transaction: typeof tx) => Promise<T>,
      _options?: { isolationLevel?: string; timeout?: number },
    ): Promise<T> => {
      const run = chain.then(() => fn(tx));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return { prisma: prisma as unknown as PrismaClient, users };
}

const validInput = {
  email: "owner@example.com",
  password: "correct horse battery staple",
  name: "Owner",
  confirmation: ADMIN_BOOTSTRAP_CONFIRMATION,
};

describe("first-admin bootstrap", () => {
  it("creates the first ADMIN with a scrypt hash and never stores plaintext", async () => {
    const { prisma, users } = makeFakePrisma();

    const created = await createFirstAdmin(prisma, validInput);

    expect(created).toEqual({ id: "user-1", email: "owner@example.com", role: "ADMIN" });
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("ADMIN");
    expect(users[0].status).toBe("ACTIVE");
    expect(users[0].passwordHash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(users[0].passwordHash).not.toContain(validInput.password);
    await expect(verifyPassword(validInput.password, users[0].passwordHash)).resolves.toBe(true);
  });

  it("normalizes the email and trims the optional name", async () => {
    const { prisma, users } = makeFakePrisma();

    await createFirstAdmin(prisma, {
      ...validInput,
      email: "  Owner@Example.COM  ",
      name: "  Owner Name  ",
    });

    expect(users[0].email).toBe("owner@example.com");
    expect(users[0].name).toBe("Owner Name");
  });

  it("refuses to create a second administrator once one exists", async () => {
    const { prisma, users } = makeFakePrisma([
      {
        id: "existing-admin",
        email: "existing@example.com",
        passwordHash: "scrypt$16384$8$1$aa$bb",
        name: "",
        role: "ADMIN",
        status: "ACTIVE",
      },
    ]);

    await expect(createFirstAdmin(prisma, validInput)).rejects.toMatchObject({
      name: "AdminBootstrapError",
      code: "ADMIN_EXISTS",
    });
    expect(users).toHaveLength(1);
  });

  it("allows only one winner under concurrent bootstrap attempts", async () => {
    const { prisma, users } = makeFakePrisma();

    const results = await Promise.allSettled([
      createFirstAdmin(prisma, { ...validInput, email: "first@example.com" }),
      createFirstAdmin(prisma, { ...validInput, email: "second@example.com" }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AdminBootstrapError);
    expect((rejected[0].reason as AdminBootstrapError).code).toBe("ADMIN_EXISTS");
    expect(users.filter((user) => user.role === "ADMIN")).toHaveLength(1);
  });

  it("fails closed without the explicit confirmation phrase", async () => {
    const { prisma, users } = makeFakePrisma();

    await expect(
      createFirstAdmin(prisma, { ...validInput, confirmation: "yes" }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(users).toHaveLength(0);
  });

  it("rejects invalid email addresses", async () => {
    const { prisma } = makeFakePrisma();

    await expect(createFirstAdmin(prisma, { ...validInput, email: "not-an-email" })).rejects.toMatchObject({
      code: "INVALID_EMAIL",
    });
  });

  it("rejects weak or oversized passwords", async () => {
    const { prisma } = makeFakePrisma();

    await expect(createFirstAdmin(prisma, { ...validInput, password: "short1234" })).rejects.toMatchObject({
      code: "WEAK_PASSWORD",
    });
    await expect(
      createFirstAdmin(prisma, { ...validInput, password: "x".repeat(201) }),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("refuses an email already used by a non-admin account", async () => {
    const { prisma, users } = makeFakePrisma([
      {
        id: "existing-user",
        email: "owner@example.com",
        passwordHash: "scrypt$16384$8$1$aa$bb",
        name: "",
        role: "USER",
        status: "ACTIVE",
      },
    ]);

    await expect(createFirstAdmin(prisma, validInput)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("USER");
  });
});
