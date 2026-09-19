import "server-only";
import { PrismaClient } from "@prisma/client";

export class DbUnavailableError extends Error {
  constructor(message = "DATABASE_URL is not configured") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new DbUnavailableError();
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

export function isDbUnavailableError(error: unknown): error is DbUnavailableError {
  return error instanceof DbUnavailableError || (error instanceof Error && error.name === "DbUnavailableError");
}
