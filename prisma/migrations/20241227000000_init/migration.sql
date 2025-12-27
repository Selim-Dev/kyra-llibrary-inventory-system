-- CreateEnum
CREATE TYPE "BorrowStatus" AS ENUM ('ACTIVE', 'RETURNED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ACTIVE', 'CANCELED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('BORROW_INCOME', 'BUY_INCOME', 'CANCEL_REFUND', 'RESTOCK_EXPENSE', 'INITIAL_BALANCE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('RESTOCK', 'REMINDER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BORROW', 'RETURN', 'BUY', 'CANCEL_BUY', 'RESTOCK_SCHEDULED', 'RESTOCK_DELIVERED', 'REMINDER_SENT', 'LOW_STOCK_EMAIL', 'MILESTONE_EMAIL');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('LOW_STOCK', 'REMINDER', 'MILESTONE');

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "isbn" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "genres" TEXT[],
    "sellPriceCents" INTEGER NOT NULL,
    "borrowPriceCents" INTEGER NOT NULL,
    "stockPriceCents" INTEGER NOT NULL,
    "availableCopies" INTEGER NOT NULL,
    "seededCopies" INTEGER NOT NULL,
    "year" INTEGER,
    "pages" INTEGER,
    "publisher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "borrowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "status" "BorrowStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeKey" TEXT,

    CONSTRAINT "Borrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryWallet" (
    "id" TEXT NOT NULL DEFAULT 'library-wallet',
    "milestoneReached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletMovement" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" "MovementType" NOT NULL,
    "reason" TEXT NOT NULL,
    "relatedEntity" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletMovement_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "activeKey" TEXT,
    "bookId" TEXT,
    "borrowId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "userId" TEXT,
    "bookId" TEXT,
    "borrowId" TEXT,
    "purchaseId" TEXT,
    "jobId" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedEmail" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "EmailType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "Book_isbn_key" ON "Book"("isbn");

-- CreateIndex
CREATE INDEX "Book_title_idx" ON "Book"("title");

-- CreateIndex
CREATE INDEX "Book_authors_idx" ON "Book" USING GIN ("authors");

-- CreateIndex
CREATE INDEX "Book_genres_idx" ON "Book" USING GIN ("genres");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Borrow_activeKey_key" ON "Borrow"("activeKey");

-- CreateIndex
CREATE INDEX "Borrow_userId_status_idx" ON "Borrow"("userId", "status");

-- CreateIndex
CREATE INDEX "Borrow_bookId_idx" ON "Borrow"("bookId");

-- CreateIndex
CREATE INDEX "Borrow_dueAt_idx" ON "Borrow"("dueAt");

-- CreateIndex
CREATE INDEX "Purchase_userId_status_idx" ON "Purchase"("userId", "status");

-- CreateIndex
CREATE INDEX "Purchase_bookId_idx" ON "Purchase"("bookId");

-- CreateIndex
CREATE INDEX "Purchase_purchasedAt_idx" ON "Purchase"("purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletMovement_dedupeKey_key" ON "WalletMovement"("dedupeKey");

-- CreateIndex
CREATE INDEX "WalletMovement_walletId_idx" ON "WalletMovement"("walletId");

-- CreateIndex
CREATE INDEX "WalletMovement_type_idx" ON "WalletMovement"("type");

-- CreateIndex
CREATE INDEX "WalletMovement_createdAt_idx" ON "WalletMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_activeKey_key" ON "Job"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_borrowId_key" ON "Job"("borrowId");

-- CreateIndex
CREATE INDEX "Job_type_status_runAt_idx" ON "Job"("type", "status", "runAt");

-- CreateIndex
CREATE INDEX "Job_bookId_type_status_idx" ON "Job"("bookId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupeKey_key" ON "Event"("dedupeKey");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_userId_idx" ON "Event"("userId");

-- CreateIndex
CREATE INDEX "Event_bookId_idx" ON "Event"("bookId");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedEmail_dedupeKey_key" ON "SimulatedEmail"("dedupeKey");

-- CreateIndex
CREATE INDEX "SimulatedEmail_recipient_idx" ON "SimulatedEmail"("recipient");

-- CreateIndex
CREATE INDEX "SimulatedEmail_createdAt_idx" ON "SimulatedEmail"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_userId_endpoint_key" ON "IdempotencyKey"("key", "userId", "endpoint");


-- AddForeignKey
ALTER TABLE "Borrow" ADD CONSTRAINT "Borrow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrow" ADD CONSTRAINT "Borrow_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletMovement" ADD CONSTRAINT "WalletMovement_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "LibraryWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_borrowId_fkey" FOREIGN KEY ("borrowId") REFERENCES "Borrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_borrowId_fkey" FOREIGN KEY ("borrowId") REFERENCES "Borrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
