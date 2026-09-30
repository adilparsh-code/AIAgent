-- TOTP second factor (RFC 6238) — purely additive hardening of Phase 6A auth.
-- Adds two new tables and one index. No existing table, column, or row is
-- modified, dropped, or rewritten; existing password-only users keep working
-- unchanged (their login path is untouched until they enroll in 2FA).

-- CreateTable
CREATE TABLE "TotpSecret" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotpSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TotpSecret_userId_key" ON "TotpSecret"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TotpRecoveryCode_codeHash_key" ON "TotpRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_idx" ON "TotpRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "TotpSecret" ADD CONSTRAINT "TotpSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
