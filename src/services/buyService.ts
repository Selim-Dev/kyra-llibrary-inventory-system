/**
 * Buy Service - Handles book buying and cancel operations
 *
 * Key features:
 * - Single transaction with advisory lock per user for concurrency control
 * - Enforces per-book limit (2) and total limit (10) excluding canceled
 * - Atomic inventory decrement
 * - Creates wallet movements, events with dedupeKey
 * - Checks for low stock and wallet milestone
 * - Cancel within 5 minutes with idempotency
 */

import { Prisma, Purchase, Book } from '@prisma/client';
import prisma from '../prisma/client';
import { NotFoundError, ConflictError, BadRequestError } from '../utils/errors';

// Constants
const MAX_COPIES_PER_BOOK = 2;
const MAX_TOTAL_COPIES = 10;
const LOW_STOCK_THRESHOLD = 1;
const WALLET_MILESTONE_CENTS = 200000; // $2000
const CANCEL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface BuyResult {
  purchase: Purchase & { book: Book };
  isExisting: boolean;
}

export interface CancelResult {
  purchase: Purchase & { book: Book };
  isExisting: boolean; // True if returning already-canceled purchase (idempotent)
}

/**
 * Hash a string to a 32-bit integer for use as advisory lock key
 */
function hashTextToInt(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}


/**
 * Buy a book for a user
 *
 * @param userEmail - The email of the user buying the book
 * @param bookIsbn - The ISBN of the book to buy
 * @returns BuyResult with the purchase record and whether it was existing
 */
export async function buyBook(userEmail: string, bookIsbn: string): Promise<BuyResult> {
  // Single transaction with advisory lock inside
  return prisma.$transaction(
    async (tx) => {
      // 0. Acquire advisory lock for this user (serializes concurrent requests)
      // Uses same lock as borrow to prevent limit bypass under concurrency
      const lockKey = hashTextToInt(userEmail);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      // Get or create user
      const user = await tx.user.upsert({
        where: { email: userEmail },
        create: { email: userEmail },
        update: {},
      });

      // 1. Get book first to check if it exists
      const book = await tx.book.findUnique({
        where: { isbn: bookIsbn },
      });

      if (!book) {
        throw new NotFoundError('BOOK_NOT_FOUND', 'Book not found');
      }

      // 2. Check per-book limit (2 non-canceled copies)
      const bookPurchases = await tx.purchase.count({
        where: {
          userId: user.id,
          bookId: book.id,
          status: 'ACTIVE',
        },
      });

      if (bookPurchases >= MAX_COPIES_PER_BOOK) {
        throw new ConflictError('BOOK_BUY_LIMIT_EXCEEDED', 'Maximum 2 copies per book allowed');
      }

      // 3. Check total limit (10 non-canceled copies across all books)
      const totalPurchases = await tx.purchase.count({
        where: {
          userId: user.id,
          status: 'ACTIVE',
        },
      });

      if (totalPurchases >= MAX_TOTAL_COPIES) {
        throw new ConflictError('TOTAL_BUY_LIMIT_EXCEEDED', 'Maximum 10 total purchases allowed');
      }

      // 4. Atomic decrement (prevents negative inventory)
      const updated = await tx.$executeRaw`
        UPDATE "Book" 
        SET "availableCopies" = "availableCopies" - 1,
            "updatedAt" = NOW()
        WHERE "isbn" = ${bookIsbn} AND "availableCopies" >= 1
      `;

      if (updated === 0) {
        throw new ConflictError('NO_COPIES_AVAILABLE', 'No copies available');
      }

      // 5. Create purchase record
      const purchase = await tx.purchase.create({
        data: {
          userId: user.id,
          bookId: book.id,
          priceCents: book.sellPriceCents,
          status: 'ACTIVE',
        },
        include: { book: true },
      });

      // 6. Credit wallet with dedupeKey
      await tx.walletMovement.create({
        data: {
          walletId: 'library-wallet',
          amountCents: book.sellPriceCents,
          type: 'BUY_INCOME',
          reason: `Buy: ${book.title}`,
          relatedEntity: `purchase:${purchase.id}`,
          dedupeKey: `BUY:${purchase.id}`,
        },
      });

      // 7. Record event with dedupeKey
      await tx.event.create({
        data: {
          type: 'BUY',
          userId: user.id,
          bookId: book.id,
          purchaseId: purchase.id,
          dedupeKey: `BUY:${purchase.id}`,
        },
      });

      // 8. Check for low stock notification (at exactly 1 copy remaining)
      const updatedBook = await tx.book.findUnique({ where: { isbn: bookIsbn } });
      if (updatedBook && updatedBook.availableCopies === LOW_STOCK_THRESHOLD) {
        await scheduleRestockIfNeeded(tx, book);
      }

      // 9. Check wallet milestone
      await checkWalletMilestone(tx);

      return { purchase, isExisting: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );
}


/**
 * Cancel a purchase within 5 minutes
 *
 * @param userEmail - The email of the user canceling the purchase
 * @param purchaseId - The ID of the purchase to cancel
 * @returns CancelResult with the purchase record and whether it was already canceled
 */
export async function cancelPurchase(
  userEmail: string,
  purchaseId: string
): Promise<CancelResult> {
  // Single transaction with row lock
  return prisma.$transaction(
    async (tx) => {
      // Get user
      const user = await tx.user.findUnique({
        where: { email: userEmail },
      });

      if (!user) {
        throw new NotFoundError('PURCHASE_NOT_FOUND', 'Purchase not found');
      }

      // Lock purchase row to prevent race conditions on concurrent cancel requests
      const purchases = await tx.$queryRaw<Purchase[]>`
        SELECT * FROM "Purchase" 
        WHERE "id" = ${purchaseId} AND "userId" = ${user.id}
        FOR UPDATE
      `;

      if (purchases.length === 0) {
        throw new NotFoundError('PURCHASE_NOT_FOUND', 'Purchase not found');
      }

      const purchase = purchases[0];

      // Check if already canceled (idempotency)
      if (purchase.status === 'CANCELED') {
        const existingPurchase = await tx.purchase.findUnique({
          where: { id: purchaseId },
          include: { book: true },
        });
        return { purchase: existingPurchase!, isExisting: true };
      }

      // Check if within 5 minute window
      const purchaseTime = new Date(purchase.purchasedAt).getTime();
      const now = Date.now();
      if (now - purchaseTime > CANCEL_WINDOW_MS) {
        throw new BadRequestError(
          'CANCELLATION_WINDOW_EXPIRED',
          'Purchase can only be canceled within 5 minutes'
        );
      }

      // Get book for refund amount
      const book = await tx.book.findUnique({
        where: { id: purchase.bookId },
      });

      if (!book) {
        throw new NotFoundError('BOOK_NOT_FOUND', 'Book not found');
      }

      // Update purchase status to CANCELED
      const canceledPurchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
        },
        include: { book: true },
      });

      // Refund wallet with dedupeKey (negative amount = debit from library perspective)
      await tx.walletMovement.create({
        data: {
          walletId: 'library-wallet',
          amountCents: -purchase.priceCents, // Negative for refund
          type: 'CANCEL_REFUND',
          reason: `Cancel: ${book.title}`,
          relatedEntity: `purchase:${purchase.id}`,
          dedupeKey: `CANCEL:${purchase.id}`,
        },
      });

      // Increment inventory
      await tx.$executeRaw`
        UPDATE "Book" 
        SET "availableCopies" = "availableCopies" + 1,
            "updatedAt" = NOW()
        WHERE "id" = ${purchase.bookId}
      `;

      // Record event with dedupeKey
      await tx.event.create({
        data: {
          type: 'CANCEL_BUY',
          userId: user.id,
          bookId: book.id,
          purchaseId: purchase.id,
          dedupeKey: `CANCEL_BUY:${purchase.id}`,
        },
      });

      return { purchase: canceledPurchase, isExisting: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    }
  );
}


/**
 * Schedule a restock job if one doesn't already exist for this book
 */
async function scheduleRestockIfNeeded(
  tx: Prisma.TransactionClient,
  book: Book
): Promise<void> {
  // Check if there's already a pending restock job for this book
  const existingJob = await tx.job.findFirst({
    where: {
      bookId: book.id,
      type: 'RESTOCK',
      activeKey: { not: null },
    },
  });

  if (existingJob) {
    return; // Already have a pending restock job
  }

  // Schedule restock for 1 hour later
  const runAt = new Date(Date.now() + 60 * 60 * 1000);

  // Create restock job
  const job = await tx.job.create({
    data: {
      type: 'RESTOCK',
      bookId: book.id,
      activeKey: `RESTOCK:${book.id}`,
      payload: { bookId: book.id, isbn: book.isbn },
      runAt,
    },
  });

  // Create low stock email
  const emailDedupeKey = `LOW_STOCK:${book.isbn}:${job.id}`;
  await tx.simulatedEmail.create({
    data: {
      recipient: 'supply@library.com',
      subject: `Low Stock Alert: ${book.title}`,
      body: `Book "${book.title}" (ISBN: ${book.isbn}) has only 1 copy remaining. A restock has been scheduled.`,
      type: 'LOW_STOCK',
      dedupeKey: emailDedupeKey,
    },
  });

  // Record low stock email event
  await tx.event.create({
    data: {
      type: 'LOW_STOCK_EMAIL',
      bookId: book.id,
      jobId: job.id,
      dedupeKey: `LOW_STOCK_EMAIL:${book.isbn}:${job.id}`,
    },
  });

  // Record restock scheduled event
  await tx.event.create({
    data: {
      type: 'RESTOCK_SCHEDULED',
      bookId: book.id,
      jobId: job.id,
      dedupeKey: `RESTOCK_SCHEDULED:${job.id}`,
    },
  });
}

/**
 * Check if wallet has reached the $2000 milestone and send notification
 */
async function checkWalletMilestone(tx: Prisma.TransactionClient): Promise<void> {
  // Get wallet
  const wallet = await tx.libraryWallet.findUnique({
    where: { id: 'library-wallet' },
  });

  if (!wallet || wallet.milestoneReached) {
    return; // Wallet doesn't exist or milestone already reached
  }

  // Calculate current balance
  const result = await tx.walletMovement.aggregate({
    where: { walletId: 'library-wallet' },
    _sum: { amountCents: true },
  });

  const balanceCents = result._sum.amountCents || 0;

  if (balanceCents > WALLET_MILESTONE_CENTS) {
    // Mark milestone as reached
    await tx.libraryWallet.update({
      where: { id: 'library-wallet' },
      data: { milestoneReached: true },
    });

    // Create milestone email
    const formattedBalance = (balanceCents / 100).toFixed(2);
    await tx.simulatedEmail.create({
      data: {
        recipient: 'management@dummy-library.com',
        subject: 'Wallet Milestone Reached: $2000!',
        body: `Congratulations! The library wallet has exceeded $2000. Current balance: ${formattedBalance}`,
        type: 'MILESTONE',
        dedupeKey: 'MILESTONE:2000',
      },
    });

    // Record milestone event
    await tx.event.create({
      data: {
        type: 'MILESTONE_EMAIL',
        metadata: { balanceCents },
        dedupeKey: 'MILESTONE_EMAIL:2000',
      },
    });
  }
}

export default {
  buyBook,
  cancelPurchase,
};
