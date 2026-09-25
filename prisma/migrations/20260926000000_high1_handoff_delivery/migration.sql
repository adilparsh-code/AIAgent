-- HIGH-1: durable delivery state for the cross-repository AIAgent → AI Income Lab
-- handoff transport.
--
-- AIAgent previously created and stored a handoff contract with no outbound
-- transport at all. This table is the delivery audit trail that makes a
-- cross-repository delivery observable and replay-safe:
--
--   * `idempotencyKey` is UNIQUE, so retrying the same handoff updates the
--     existing row instead of appending a second delivery record. The exact
--     same value is sent to the receiver, so both sides de-duplicate on
--     identical information.
--   * `status` is the honest delivery state. `NOT_CONFIGURED` is a first-class
--     value: while the receiver address/credential are absent, delivery is
--     recorded as not configured rather than as succeeded.
--   * The delivery credential is NOT stored in this table — only a bounded,
--     redacted diagnostic message and a machine-readable error code.
--
-- Additive only: no existing table is altered and no existing row is removed.
CREATE TABLE "HandoffDelivery" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "httpStatus" INTEGER,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoffDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandoffDelivery_idempotencyKey_key" ON "HandoffDelivery"("idempotencyKey");
CREATE INDEX "HandoffDelivery_handoffId_idx" ON "HandoffDelivery"("handoffId");
CREATE INDEX "HandoffDelivery_status_idx" ON "HandoffDelivery"("status");
CREATE INDEX "HandoffDelivery_requestedById_idx" ON "HandoffDelivery"("requestedById");

ALTER TABLE "HandoffDelivery"
  ADD CONSTRAINT "HandoffDelivery_handoffId_fkey"
  FOREIGN KEY ("handoffId") REFERENCES "Handoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HandoffDelivery"
  ADD CONSTRAINT "HandoffDelivery_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
