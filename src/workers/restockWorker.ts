/**
 * Restock Worker - Processes automatic book restocking using BullMQ
 *
 * Key features:
 * - Compute needed = seededCopies - currentAvailable
 * - Skip if needed <= 0
 * - Debit wallet with dedupeKey
 * - Increment inventory
 * - Create event with dedupeKey
 * - Handle insufficient funds with retry (throws error to trigger backoff)
 */

import { Worker, Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';
import redisConfig from '../config/redis';
import { RestockJobData } from '../queues';
import {
  addMovementInTransaction,
  getBalanceInTransaction,
} from '../services/walletService';

/**
 * Error thrown when wallet has insufficient funds for restock
 */
export class InsufficientFundsError extends Error {
  constructor(required: number, available: number) {
    super(
      `Insufficient funds for restock. Required: ${required} cents, Available: ${available} cents`
    );
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Process a restock job
 */
async function processRestockJob(job: Job<RestockJobData>): Promise<void> {
  const { bookId, bookTitle } = job.data;

  console.log(`Processing restock job ${job.id} for book ${bookId}`);

  // Execute restock in a transaction
  await prisma.$transaction(
    async (tx) => {
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
        console.log(
          `Restock job ${job.id}: No restock needed for ${book.title} (available: ${book.availableCopies}, seeded: ${book.seededCopies})`
        );
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
      // Use job.id as unique identifier for this restock attempt
      await addMovementInTransaction(tx, {
        amountCents: -totalCostCents,
        type: 'RESTOCK_EXPENSE',
        reason: `Restock: ${needed} copies of "${book.title}"`,
        relatedEntity: `bullmq:${job.id}`,
        dedupeKey: `RESTOCK:bullmq:${job.id}`,
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
          metadata: {
            copiesAdded: needed,
            totalCostCents,
            previousAvailable: book.availableCopies,
            newAvailable: book.availableCopies + needed,
            jobId: job.id,
          },
          dedupeKey: `RESTOCK_DELIVERED:bullmq:${job.id}`,
        },
      });

      console.log(
        `Restock job ${job.id}: Added ${needed} copies of "${book.title}" for ${totalCostCents} cents`
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );
}

/**
 * Create and start the restock worker
 */
export function createRestockWorker(): Worker<RestockJobData> {
  const worker = new Worker<RestockJobData>(
    'restock',
    async (job) => {
      await processRestockJob(job);
    },
    {
      connection: redisConfig,
      concurrency: 3, // Process up to 3 restock jobs concurrently
      limiter: {
        max: 10, // Max 10 jobs
        duration: 60000, // Per minute (rate limiting)
      },
    }
  );

  // Event listeners
  worker.on('completed', (job) => {
    console.log(`Restock job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    if (err instanceof InsufficientFundsError) {
      console.warn(`Restock job ${job?.id} failed (insufficient funds), will retry:`, err.message);
    } else {
      console.error(`Restock job ${job?.id} failed:`, err.message);
    }
  });

  worker.on('error', (err) => {
    console.error('Restock worker error:', err);
  });

  console.log('Restock worker started');

  return worker;
}

export default createRestockWorker;
