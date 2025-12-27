/**
 * Restock Job Handler - Handles automatic book restocking
 *
 * Key features:
 * - Compute needed = seededCopies - currentAvailable
 * - Skip if needed <= 0
 * - Debit wallet with dedupeKey
 * - Increment inventory
 * - Create event with dedupeKey
 * - Handle insufficient funds with retry (throws error to trigger backoff)
 *
 * Requirements: 12.1-12.12
 */

import { Job, Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import { addMovementInTransaction, getBalanceInTransaction } from '../services/walletService';

/**
 * Restock job payload type
 */
interface RestockPayload {
  bookId: string;
  isbn: string;
}

/**
 * Error thrown when wallet has insufficient funds for restock
 */
export class InsufficientFundsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient funds for restock. Required: ${required} cents, Available: ${available} cents`);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Handle a restock job
 *
 * @param job - The restock job to process
 * @throws InsufficientFundsError if wallet doesn't have enough funds (triggers retry)
 */
export async function handleRestockJob(job: Job): Promise<void> {
  const payload = job.payload as unknown as RestockPayload;
  const { bookId } = payload;

  // Execute restock in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Get the book to check current inventory and seeded copies
    const book = await tx.book.findUnique({
      where: { id: bookId },
    });

    if (!book) {
      console.log(`Restock job ${job.id}: Book ${bookId} not found, skipping`);
      return;
    }

    // 2. Compute needed copies
    const needed = book.seededCopies - book.availableCopies;

    // 3. Skip if no restock needed
    if (needed <= 0) {
      console.log(`Restock job ${job.id}: No restock needed for ${book.title} (available: ${book.availableCopies}, seeded: ${book.seededCopies})`);
      return;
    }

    // 4. Calculate total cost
    const totalCostCents = needed * book.stockPriceCents;

    // 5. Check wallet balance
    const { balanceCents } = await getBalanceInTransaction(tx);

    if (balanceCents < totalCostCents) {
      // Throw error to trigger retry with exponential backoff
      throw new InsufficientFundsError(totalCostCents, balanceCents);
    }

    // 6. Debit wallet with dedupeKey (negative amount = debit)
    await addMovementInTransaction(tx, {
      amountCents: -totalCostCents,
      type: 'RESTOCK_EXPENSE',
      reason: `Restock: ${needed} copies of "${book.title}"`,
      relatedEntity: `job:${job.id}`,
      dedupeKey: `RESTOCK:${job.id}`,
    });

    // 7. Increment inventory
    await tx.$executeRaw`
      UPDATE "Book"
      SET "availableCopies" = "availableCopies" + ${needed},
          "updatedAt" = NOW()
      WHERE "id" = ${bookId}
    `;

    // 8. Create restock delivered event with dedupeKey
    await tx.event.create({
      data: {
        type: 'RESTOCK_DELIVERED',
        bookId: book.id,
        jobId: job.id,
        metadata: {
          copiesAdded: needed,
          totalCostCents,
          previousAvailable: book.availableCopies,
          newAvailable: book.availableCopies + needed,
        },
        dedupeKey: `RESTOCK_DELIVERED:${job.id}`,
      },
    });

    console.log(`Restock job ${job.id}: Added ${needed} copies of "${book.title}" for ${totalCostCents} cents`);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30000,
  });
}

export default handleRestockJob;
